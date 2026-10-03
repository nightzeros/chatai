"use server";

import { and, assistantProfiles, eq, type AssistantPurpose, type KeyFact } from "@chatai/database";
import {
  factFingerprint,
  instructionsHash,
  invalidateAssistantContext,
  loadKnowledgeTitles,
  suggestPurpose,
} from "@chatai/rag/answer";
import { revalidatePath } from "next/cache";

import { resolveAssistantModels } from "@/lib/ai-config";
import { getOwnedAssistant } from "@/lib/assistants";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkHostingAccountAccess, resolveBillableAccountForAssistant } from "@/lib/hosting/accounts";
import {
  abortEvalUsageReservation,
  beginProfileUsageReservation,
  finishProfileUsageReservation,
} from "@/lib/hosting/usage-gate";
import { isUsageLimitExceededError } from "@/lib/hosting/usage-limit-error";
import { createId } from "@/lib/ids";
import { enqueueProfileFactsJob } from "@/lib/profile/jobs";
import { startProfileWorker } from "@/lib/profile/worker";
import { requireSession } from "@/lib/session";

export type ProfileActionState = { error: string } | { saved: true; message?: string } | null;

type ProfileRow = typeof assistantProfiles.$inferSelect;
type ProfilePatch = Partial<
  Pick<ProfileRow, "purpose" | "purposeSuggestion" | "facts" | "suggestions" | "dismissed" | "factsPublishedAt">
>;

const STALE_VERSION = "This profile changed in another tab or by a background refresh. Reload the page and try again.";
const MAX_FACTS = 12;
const MAX_FACT_CHARS = 200;
const FORBIDDEN_REDIRECT = /[{}<>`]|https?:/i;

async function ownedAssistant(formData: FormData) {
  if (!env.ASSISTANT_PROFILE) return null;
  const session = await requireSession();
  const assistant = await getOwnedAssistant(session.user.id, String(formData.get("id") ?? ""));
  return assistant ? { session, assistant } : null;
}

/**
 * Apply an owner change under the optimistic version guard. Background refreshes
 * also bump the version, so an owner never overwrites suggestions they did not see.
 */
async function mutateProfile(
  assistantId: string,
  expectedVersion: number | null,
  change: (row: ProfileRow) => ProfilePatch | { error: string },
  userId: string,
): Promise<{ error: string } | { row: ProfileRow }> {
  try {
    await db().insert(assistantProfiles).values({ assistantId }).onConflictDoNothing();
    const [row] = await db().select().from(assistantProfiles).where(eq(assistantProfiles.assistantId, assistantId)).limit(1);
    if (!row) return { error: "Profile not found." };
    if (expectedVersion !== null && row.version !== expectedVersion) return { error: STALE_VERSION };
    const patch = change(row);
    if ("error" in patch) return patch;
    const [updated] = await db()
      .update(assistantProfiles)
      .set({ ...patch, version: row.version + 1, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(assistantProfiles.assistantId, assistantId), eq(assistantProfiles.version, row.version)))
      .returning();
    if (!updated) return { error: STALE_VERSION };
    invalidateAssistantContext(assistantId);
    return { row: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/assistant_profiles/.test(message)) {
      return { error: "The Assistant Profile tables are missing. Apply database migration 0020 first." };
    }
    throw error;
  }
}

function versionOf(formData: FormData): number | null {
  const raw = formData.get("version");
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").replace(/\s+/g, " ").trim();
}

async function audit(userId: string, assistantId: string, change: string, metadata: Record<string, unknown> = {}) {
  await logAuditEvent({
    userId,
    action: "assistant_profile_updated",
    resourceType: "assistant",
    resourceId: assistantId,
    metadata: { change, ...metadata },
  });
}

function done(assistantId: string, message?: string): ProfileActionState {
  revalidatePath(`/dashboard/assistants/${assistantId}/profile`);
  return { saved: true, ...(message ? { message } : {}) };
}

// --- Purpose -----------------------------------------------------------------

export async function savePurpose(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const summary = String(formData.get("summary") ?? "").trim();
  const represents = text(formData, "represents");
  const redirect = text(formData, "redirect");
  const mode = formData.get("mode") === "general" ? "general" : "focused";
  if (summary.length < 10 || summary.length > 2_000) {
    return { error: "Describe what the assistant helps with in 10 to 2,000 characters." };
  }
  if (represents.length > 80) return { error: "Keep “Represents” under 80 characters." };
  if (redirect && (redirect.length > 240 || FORBIDDEN_REDIRECT.test(redirect))) {
    return { error: "Keep the redirect to one short sentence without links or code." };
  }
  const purpose: AssistantPurpose = {
    summary,
    represents: represents || null,
    redirect: redirect || null,
    mode,
    origin: "owner",
    instructionsHash: instructionsHash(assistant.instructions),
    confirmedAt: new Date().toISOString(),
  };
  const result = await mutateProfile(assistant.id, versionOf(formData), () => ({ purpose, purposeSuggestion: null }), session.user.id);
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, "purpose_saved", { mode, hasRedirect: Boolean(redirect) });
  return done(assistant.id, "Purpose saved. Text and Voice use it from the next message or call.");
}

export async function clearPurpose(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const result = await mutateProfile(assistant.id, versionOf(formData), () => ({ purpose: null }), session.user.id);
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, "purpose_cleared");
  return done(assistant.id, "Purpose cleared. Scope falls back to your Instructions.");
}

export async function requestPurposeSuggestion(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const models = await resolveAssistantModels(assistant);
  const account = await resolveBillableAccountForAssistant(assistant);
  const access = checkHostingAccountAccess(account);
  if (!access.ok) return { error: access.error };
  const requestId = createId();
  let reservation;
  try {
    reservation = await beginProfileUsageReservation({
      account,
      assistantId: assistant.id,
      requestId,
      chat: models.chat,
      embedding: models.embedding,
      billing: models.billing,
    });
  } catch (error) {
    if (isUsageLimitExceededError(error)) return { error: "Usage limit reached. Try again later." };
    throw error;
  }
  let suggestion;
  try {
    const titles = await loadKnowledgeTitles(db(), assistant.id);
    const result = await suggestPurpose({
      assistantName: assistant.name,
      description: assistant.description,
      instructions: assistant.instructions,
      knowledgeTitles: titles,
      chat: models.chat,
      now: new Date().toISOString(),
    });
    await finishProfileUsageReservation({
      reservation,
      accountId: account.id,
      assistantId: assistant.id,
      requestId,
      records: result.usages,
      billing: models.billing,
    });
    suggestion = result.suggestion;
  } catch {
    await abortEvalUsageReservation(reservation).catch(() => undefined);
    return { error: "Could not draft a suggestion right now. Try again." };
  }
  if (!suggestion) return { error: "Could not draft a usable suggestion. Write the Purpose yourself." };
  const result = await mutateProfile(assistant.id, versionOf(formData), () => ({ purposeSuggestion: suggestion }), session.user.id);
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, "purpose_suggested", { basis: suggestion.basis });
  return done(assistant.id, "Suggestion ready. Review it, edit it if needed, and save.");
}

export async function dismissPurposeSuggestion(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const result = await mutateProfile(assistant.id, versionOf(formData), () => ({ purposeSuggestion: null }), session.user.id);
  if ("error" in result) return result;
  return done(assistant.id);
}

// --- Key facts ---------------------------------------------------------------

export async function generateFacts(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  try {
    await db().insert(assistantProfiles).values({ assistantId: assistant.id }).onConflictDoNothing();
    await db()
      .update(assistantProfiles)
      .set({ refreshStatus: "pending", lastError: null, updatedAt: new Date() })
      .where(eq(assistantProfiles.assistantId, assistant.id));
    await enqueueProfileFactsJob(db(), assistant.id, "owner");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/assistant_profile/.test(message)) {
      return { error: "The Assistant Profile tables are missing. Apply database migration 0020 first." };
    }
    throw error;
  }
  startProfileWorker();
  await audit(session.user.id, assistant.id, "facts_generation_requested");
  return done(assistant.id, "Generating suggestions from your Knowledge. This usually takes under a minute.");
}

function publish(row: ProfileRow, facts: KeyFact[], extra: ProfilePatch = {}): ProfilePatch {
  return { facts, factsPublishedAt: row.factsPublishedAt ?? new Date(), ...extra };
}

function acceptInto(row: ProfileRow, ids: Set<string>): ProfilePatch | { error: string } {
  const accepted = row.suggestions.filter((s) => ids.has(s.id));
  if (accepted.length === 0) return { error: "That suggestion is no longer available. Reload the page." };
  let facts = [...row.facts];
  for (const suggestion of accepted) {
    const { replacesFactId } = suggestion;
    if (replacesFactId) {
      const target = facts.find((f) => f.id === replacesFactId);
      if (target?.origin === "owner") continue;
      facts = facts.filter((f) => f.id !== replacesFactId);
    }
    facts.push({
      id: suggestion.id,
      text: suggestion.text,
      topic: suggestion.topic,
      origin: "generated",
      sources: suggestion.sources,
      createdAt: suggestion.createdAt,
    });
  }
  if (facts.length > MAX_FACTS) return { error: `Keep at most ${MAX_FACTS} key facts. Remove one first.` };
  return publish(row, facts, { suggestions: row.suggestions.filter((s) => !ids.has(s.id)) });
}

export async function acceptSuggestion(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const result = await mutateProfile(assistant.id, versionOf(formData), (row) => acceptInto(row, new Set([suggestionId])), session.user.id);
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, "fact_accepted");
  return done(assistant.id);
}

export async function acceptAllSuggestions(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const result = await mutateProfile(
    assistant.id,
    versionOf(formData),
    (row) => acceptInto(row, new Set(row.suggestions.map((s) => s.id))),
    session.user.id,
  );
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, "facts_accepted_all", { facts: result.row.facts.length });
  return done(assistant.id, "Key facts published.");
}

export async function rejectSuggestion(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const result = await mutateProfile(
    assistant.id,
    versionOf(formData),
    (row) => {
      const suggestion = row.suggestions.find((s) => s.id === suggestionId);
      if (!suggestion) return { error: "That suggestion is no longer available. Reload the page." };
      return {
        suggestions: row.suggestions.filter((s) => s.id !== suggestionId),
        dismissed: [...new Set([...row.dismissed, factFingerprint(suggestion)])],
      };
    },
    session.user.id,
  );
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, "fact_rejected");
  return done(assistant.id);
}

export async function saveFact(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const factId = String(formData.get("factId") ?? "");
  const factText = text(formData, "text");
  const topic = text(formData, "topic").slice(0, 40) || "general";
  if (factText.length < 3 || factText.length > MAX_FACT_CHARS) {
    return { error: `Keep each key fact between 3 and ${MAX_FACT_CHARS} characters.` };
  }
  const result = await mutateProfile(
    assistant.id,
    versionOf(formData),
    (row) => {
      // Owner-written or owner-edited facts are protected from automatic replacement.
      const ownerFact: KeyFact = {
        id: factId || createId(),
        text: factText,
        topic,
        origin: "owner",
        sources: [],
        createdAt: new Date().toISOString(),
      };
      if (factId) {
        if (!row.facts.some((f) => f.id === factId)) return { error: "That fact no longer exists. Reload the page." };
        return publish(row, row.facts.map((f) => (f.id === factId ? ownerFact : f)));
      }
      if (row.facts.length >= MAX_FACTS) return { error: `Keep at most ${MAX_FACTS} key facts. Remove one first.` };
      return publish(row, [...row.facts, ownerFact]);
    },
    session.user.id,
  );
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, factId ? "fact_edited" : "fact_added");
  return done(assistant.id);
}

export async function removeFact(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const owned = await ownedAssistant(formData);
  if (!owned) return { error: "Assistant not found." };
  const { session, assistant } = owned;
  const factId = String(formData.get("factId") ?? "");
  const result = await mutateProfile(
    assistant.id,
    versionOf(formData),
    (row) => {
      const fact = row.facts.find((f) => f.id === factId);
      if (!fact) return { error: "That fact no longer exists. Reload the page." };
      return {
        facts: row.facts.filter((f) => f.id !== factId),
        ...(fact.origin === "generated" ? { dismissed: [...new Set([...row.dismissed, factFingerprint(fact)])] } : {}),
      };
    },
    session.user.id,
  );
  if ("error" in result) return result;
  await audit(session.user.id, assistant.id, "fact_removed");
  return done(assistant.id);
}