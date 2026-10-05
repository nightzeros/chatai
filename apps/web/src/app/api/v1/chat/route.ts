import { generateChat, streamChat } from "@chatai/ai";
import {
  assistants,
  conversations,
  eq,
  messages,
  type ConversationSource,
} from "@chatai/database";
import {
  finalizeAnswer,
  generateGuardedAnswer,
  prepareAnswer,
  resolveRagSettings,
  type ChatHistoryMessage,
  type ProviderUsageRecord,
} from "@chatai/rag/answer";
import { enqueueOnlineEvalJob, shouldSampleEval } from "@chatai/evals";
import { z } from "zod";

import { resolveAssistantModels } from "@/lib/ai-config";
import { usesApiKeyAuth } from "@/lib/api-keys";
import { getOwnedAssistantByRef } from "@/lib/assistants";
import { authorizeV1 } from "@/lib/authorize-v1";

import { startEvalWorker } from "@/lib/eval-worker";
import {
  clientHistorySchema,
  fromClientHistory,
  loadRecentConversationHistory,
} from "@/lib/conversation-history";
import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  checkHostingAccountAccess,
  resolveBillableAccountForAssistant,
} from "@/lib/hosting/accounts";
import {
  abortChatUsageReservation,
  beginChatUsageReservation,
  finishChatUsageReservation,
} from "@/lib/hosting/usage-gate";
import { createId } from "@/lib/ids";
import {
  isPublicVisitor,
  resolveChatSource,
  VISITOR_UNAVAILABLE_MESSAGE,
} from "@/lib/policies/chat-source";
import { policyViolationResponse } from "@/lib/policies/policy-response";
import { SecurityPolicy } from "@/lib/policies/security-policy";
import { shouldPersistChatTranscript } from "@/lib/privacy/should-persist-chat";
import { publicChatMeta } from "@/lib/public-chat-meta";
import { consumeApiKeyRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  assistantId: z.string().min(1, "assistantId is required"),
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1, "message is required").max(4000),
  visitorId: z.string().min(1).max(80).optional(),
  source: z.enum(["playground", "widget", "api"]).optional(),
  /** Recent turns held by the client; used when the server stores no transcript. */
  history: clientHistorySchema.optional(),
  /** Voice became unavailable earlier in this conversation (neutral; no reason is sent). */
  voiceUnavailable: z.boolean().optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function sseLine(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const started = Date.now();
  const apiKey = usesApiKeyAuth(request);

  let assistant;
  if (apiKey) {
    const auth = await authorizeV1(request, ["chat"]);
    if (!auth.ok) {
      return jsonWithCors({ error: auth.error }, { status: auth.status });
    }

    const limited = await consumeApiKeyRateLimit(auth.apiKeyId);
    if (!limited.ok) {
      return jsonWithCors(
        { error: "Rate limit exceeded." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }

    assistant = await getOwnedAssistantByRef(auth.userId, input.assistantId);
    if (!assistant) {
      return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
    }
  } else {
    const [row] = await db()
      .select()
      .from(assistants)
      .where(eq(assistants.publicId, input.assistantId))
      .limit(1);
    assistant = row;
  }

  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const session = !apiKey && input.source === "playground" ? await getSession() : null;
  const source: ConversationSource = resolveChatSource({
    claimed: input.source,
    apiKey,
    ownerSession: Boolean(session?.user.id) && session?.user.id === assistant.userId,
  });
  const visitor = isPublicVisitor({ apiKey, source });

  if (!apiKey) {
    const security = SecurityPolicy.fromAssistant(assistant, env);
    const violation = await security.enforceWidgetRequest(request, {
      visitorId: input.visitorId,
      message: input.message,
      source,
    });
    if (violation) {
      return policyViolationResponse(violation);
    }
  }

  const hostingAccount = await resolveBillableAccountForAssistant(assistant);
  const hostingAccess = checkHostingAccountAccess(hostingAccount);
  if (!hostingAccess.ok) {
    return visitor
      ? jsonWithCors({ error: VISITOR_UNAVAILABLE_MESSAGE }, { status: 403 })
      : jsonWithCors({ error: hostingAccess.error }, { status: hostingAccess.status });
  }

  const includeDebug = source === "playground";
  const persist = shouldPersistChatTranscript({
    assistant,
    source,
    sessionUserId: session?.user.id,
    assistantOwnerId: assistant.userId,
  });

  let conversationId = input.conversationId ?? createId();
  let history: ChatHistoryMessage[] = [];

  if (persist) {
    if (input.conversationId) {
      const [existing] = await db()
        .select()
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1);
      if (!existing || existing.assistantId !== assistant.id) {
        return jsonWithCors({ error: "Conversation not found." }, { status: 404 });
      }
      conversationId = existing.id;
    } else {
      conversationId = createId();
      await db().insert(conversations).values({
        id: conversationId,
        assistantId: assistant.id,
        visitorId: input.visitorId ?? null,
        source,
      });
    }

    // Stored turns only: client-held turns (e.g. unsaved Voice) never become history
    // for a stored conversation.
    history = await loadRecentConversationHistory(conversationId);
  } else {
    // Ephemeral id for the SSE response only — nothing is written.
    conversationId = createId();
    history = fromClientHistory(input.history);
  }

  const userMessageId = createId();
  if (persist) {
    await db().insert(messages).values({
      id: userMessageId,
      conversationId,
      role: "user",
      content: input.message,
    });
  }

  const models = await resolveAssistantModels(assistant);
  const usageRequestId = createId();
  const rag = resolveRagSettings(assistant.ragSettings);

  const gate = await beginChatUsageReservation({
    account: hostingAccount,
    assistantId: assistant.id,
    requestId: usageRequestId,
    chat: models.chat,
    embedding: models.embedding,
    billing: models.billing,
    message: input.message,
    hasHistory: history.length > 0,
    queryExpansionEnabled: rag.queryExpansion,
    rerankEnabled: rag.rerank,
    verifyCitationsEnabled: rag.guardrails.verifyCitations,
    hasCohereKey: Boolean(env.COHERE_API_KEY),
    outputScopeCheck: env.OUTPUT_SCOPE_CHECK,
    source,
  });

  if (!gate.ok) {
    return visitor
      ? jsonWithCors({ error: VISITOR_UNAVAILABLE_MESSAGE }, { status: 403 })
      : jsonWithCors({ error: gate.error, reason: gate.reason }, { status: gate.status });
  }

  const reservation = gate.reservation;
  const encoder = new TextEncoder();
  const assistantMessageId = createId();
  const accrued: ProviderUsageRecord[] = [];
  const onUsage = (record: ProviderUsageRecord) => accrued.push(record);
  let usageSettled = false;
  let disconnected = false;
  const settleUsage = (records: ProviderUsageRecord[], failed: boolean) =>
    finishChatUsageReservation({
      reservation,
      accountId: hostingAccount.id,
      assistantId: assistant.id,
      requestId: usageRequestId,
      source,
      visitorId: input.visitorId,
      records,
      billing: models.billing,
      failed,
    });

  const stream = new ReadableStream({
    async start(controller) {
      // A client that goes away does not abort the turn: it still completes, is
      // persisted and settles its usage once.
      const send = (payload: unknown) => {
        if (disconnected) return;
        try {
          controller.enqueue(encoder.encode(sseLine(payload)));
        } catch {
          disconnected = true;
        }
      };

      try {
        const initial = await prepareAnswer({
          db: db(),
          assistantId: assistant.id,
          assistantName: assistant.name,
          assistantDescription: assistant.description,
          instructions: assistant.instructions,
          mode: assistant.hallucinationMode,
          message: input.message,
          history,
          embedding: models.embedding,
          chat: models.chat,

          ragSettings: assistant.ragSettings,
          cohereApiKey: env.COHERE_API_KEY ?? null,
          voiceUnavailable: input.voiceUnavailable === true,
          outputGuard: env.OUTPUT_SCOPE_CHECK,
          profileAnswerRoute: env.PROFILE_ANSWER_ROUTE,
          onUsage,
        });

        const generated = await generateGuardedAnswer({
          prepared: initial,
          question: input.message,
          chat: models.chat,
          verifyCitations: rag.guardrails.verifyCitations,
          outputGuard: env.OUTPUT_SCOPE_CHECK,
          generate: async ({ system, messages: chatMessages }) => {
            const result = await generateChat({ config: models.chat, system, messages: chatMessages });
            return { text: result.text, usage: result.usage };
          },
          stream: async ({ system, messages: chatMessages }, onDelta) => {
            let text = "";
            const result = streamChat({ config: models.chat, system, messages: chatMessages });
            for await (const delta of result.textStream) {
              text += delta;
              onDelta(delta);
            }
            return { text, usage: await result.usage };
          },
          onDelta: (text) => send({ type: "token", text }),
          onUsage,
        });
        const prepared = generated.prepared;
        const fullText = generated.text;
        const answerUsages = generated.usages;
        if (!generated.streamed) send({ type: "token", text: fullText });

        usageSettled = true;
        await settleUsage(answerUsages, false);

        const latencyMs = Date.now() - started;
        const final = finalizeAnswer(fullText, {
          ...prepared,
          providerUsages: answerUsages,
          debug: { ...prepared.debug, latencyMs, model: models.chat.model, provider: models.chat.provider },
        });

        if (persist) {
          await db().insert(messages).values({
            id: assistantMessageId,
            conversationId,
            role: "assistant",
            content: final.answer,
            sources: final.sources,
            confidence: final.confidence,
            outcome: final.outcome,
            debug: final.debug,
            latencyMs,
          });

          if (shouldSampleEval(rag.evalSampleRate)) {
            await enqueueOnlineEvalJob({ db: db(), messageId: assistantMessageId });
            startEvalWorker();
          }

          await db()
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversationId));
        }

        send(publicChatMeta({
          messageId: assistantMessageId,
          conversationId,
          sources: final.sources,
          confidence: final.confidence,
          outcome: final.outcome,
          debug: final.debug,
        }, includeDebug));
        send({ type: "done" });
      } catch (error) {
        if (!usageSettled) {
          usageSettled = true;
          await (accrued.length > 0 ? settleUsage(accrued, true) : abortChatUsageReservation(reservation)).catch(
            (settleError: unknown) => console.error("[chat] usage settlement failed:", settleError),
          );
        }

        const message = error instanceof Error ? error.message : "Model failed.";
        const latencyMs = Date.now() - started;

        if (persist) {
          await db().insert(messages).values({
            id: assistantMessageId,
            conversationId,
            role: "assistant",
            content: "I ran into a problem generating a response. Please try again.",
            sources: [],
            confidence: 0,
            outcome: "model_failure",
            debug: { model: models.chat.model, provider: models.chat.provider, latencyMs, error: message },
            latencyMs,
          });
        }

        send({ type: "token", text: "I ran into a problem generating a response. Please try again." });
        send(publicChatMeta({
          messageId: assistantMessageId,
          conversationId,
          sources: [],
          confidence: 0,
          outcome: "model_failure",
          debug: { error: message },
        }, includeDebug));
        send({ type: "done" });
      } finally {
        if (!disconnected) controller.close();
      }
    },
    cancel() {
      disconnected = true;
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
