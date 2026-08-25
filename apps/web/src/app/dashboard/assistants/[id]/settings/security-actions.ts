"use server";

import { assistants, eq } from "@chatai/database";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getOwnedAssistant } from "@/lib/assistants";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export type SecurityPolicyActionState = { error: string } | { saved: true } | null;

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9*.-]+$/i, "Domains must be hostnames like example.com or *.vercel.app");

function parseDomains(raw: string): string[] | { error: string } {
  const parts = raw
    .split(/[\n,]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  for (const domain of unique) {
    const parsed = domainSchema.safeParse(domain);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid domain." };
    }
  }
  return unique;
}

function parseOptionalRate(value: FormDataEntryValue | null, label: string) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10_000) {
    return { error: `${label} must be an integer between 1 and 10000, or blank for the instance default.` };
  }
  return n;
}

export async function updateSecurityPolicy(
  _prev: SecurityPolicyActionState,
  formData: FormData,
): Promise<SecurityPolicyActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return { error: "Assistant not found." };
  }

  const domains = parseDomains(String(formData.get("allowedDomains") ?? ""));
  if ("error" in domains) return domains;

  const visitorLimit = parseOptionalRate(formData.get("widgetRateLimitPerVisitor"), "Visitor rate limit");
  if (visitorLimit && typeof visitorLimit === "object" && "error" in visitorLimit) return visitorLimit;

  const assistantLimit = parseOptionalRate(
    formData.get("widgetRateLimitPerAssistant"),
    "Assistant rate limit",
  );
  if (assistantLimit && typeof assistantLimit === "object" && "error" in assistantLimit) {
    return assistantLimit;
  }

  const current = assistant.securitySettings ?? {};

  await db()
    .update(assistants)
    .set({
      securitySettings: {
        ...current,
        allowedDomains: domains,
        widgetRateLimitPerVisitor: visitorLimit as number | null,
        widgetRateLimitPerAssistant: assistantLimit as number | null,
      },
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, assistant.id));

  await logAuditEvent({
    userId: session.user.id,
    action: "security_settings_updated",
    resourceType: "assistant",
    resourceId: assistant.id,
    metadata: {
      allowedDomainCount: domains.length,
      widgetRateLimitPerVisitor: visitorLimit,
      widgetRateLimitPerAssistant: assistantLimit,
    },
  });

  revalidatePath(`/dashboard/assistants/${assistant.id}`);
  revalidatePath(`/dashboard/assistants/${assistant.id}/settings`);
  revalidatePath(`/dashboard/assistants/${assistant.id}/settings/security`);
  revalidatePath(`/dashboard/assistants/${assistant.id}/install`);

  return { saved: true };
}
