"use server";

import { CHAT_PROVIDERS, EMBEDDING_PROVIDERS } from "@chatai/ai";
import { revalidatePath } from "next/cache";

import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import {
  deleteProviderSecret,
  listProviderSecretMeta,
  upsertProviderSecret,
} from "@/lib/secrets/provider-secrets";
import { requireSession } from "@/lib/session";

export type ProviderSecretsActionState = { error: string } | { saved: true } | null;

function emptyToUndefined(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export async function updateProviderSecrets(
  _prev: ProviderSecretsActionState,
  formData: FormData,
): Promise<ProviderSecretsActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return { error: "Assistant not found." };
  }

  const chatProvider =
    emptyToUndefined(formData.get("chatProvider")) ??
    assistant.modelSettings?.chatProvider ??
    env.AI_PROVIDER ??
    "openai";
  const embeddingProvider =
    emptyToUndefined(formData.get("embeddingProvider")) ??
    assistant.modelSettings?.embeddingProvider ??
    env.EMBEDDING_PROVIDER ??
    "openai";

  if (!(CHAT_PROVIDERS as readonly string[]).includes(chatProvider)) {
    return { error: `Unknown chat provider: ${chatProvider}` };
  }
  if (!(EMBEDDING_PROVIDERS as readonly string[]).includes(embeddingProvider)) {
    return { error: `Unknown embedding provider: ${embeddingProvider}` };
  }

  const chatKey = emptyToUndefined(formData.get("chatApiKey"));
  const embeddingKey = emptyToUndefined(formData.get("embeddingApiKey"));
  const clearChat = formData.get("clearChatApiKey") === "on";
  const clearEmbedding = formData.get("clearEmbeddingApiKey") === "on";

  try {
    if (clearChat) {
      await deleteProviderSecret(assistant.id, "chat");
    } else if (chatKey) {
      await upsertProviderSecret({
        assistantId: assistant.id,
        kind: "chat",
        provider: chatProvider,
        plaintext: chatKey,
        env,
      });
    }

    if (clearEmbedding) {
      await deleteProviderSecret(assistant.id, "embedding");
    } else if (embeddingKey) {
      await upsertProviderSecret({
        assistantId: assistant.id,
        kind: "embedding",
        provider: embeddingProvider,
        plaintext: embeddingKey,
        env,
      });
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save provider secrets.",
    };
  }

  revalidatePath(`/dashboard/assistants/${assistant.id}/settings`);
  return { saved: true };
}

/** Metadata for settings UI — never includes ciphertext or plaintext. */
export async function loadProviderSecretMetaForAssistant(assistantId: string) {
  return listProviderSecretMeta(assistantId);
}
