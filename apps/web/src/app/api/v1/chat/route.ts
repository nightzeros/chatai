import { streamChat } from "@chatai/ai";
import {
  assistants,
  asc,
  conversations,
  eq,
  messages,
  type ConversationSource,
} from "@chatai/database";
import {
  finalizeAnswer,
  generateVerifiedAnswer,
  prepareAnswer,
  resolveRagSettings,
  withVerifierResult,
} from "@chatai/rag/answer";
import { enqueueOnlineEvalJob, shouldSampleEval } from "@chatai/evals";
import { z } from "zod";

import { resolveAssistantModels } from "@/lib/ai-config";
import { usesApiKeyAuth } from "@/lib/api-keys";
import { getOwnedAssistantByRef } from "@/lib/assistants";
import { authorizeV1 } from "@/lib/authorize-v1";

import { startEvalWorker } from "@/lib/eval-worker";
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
  const source: ConversationSource = input.source ?? "api";
  const started = Date.now();

  let assistant;
  if (usesApiKeyAuth(request)) {
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

  const hostingAccount = await resolveBillableAccountForAssistant(assistant);
  const hostingAccess = checkHostingAccountAccess(hostingAccount);
  if (!hostingAccess.ok) {
    return jsonWithCors({ error: hostingAccess.error }, { status: hostingAccess.status });
  }

  if (!usesApiKeyAuth(request)) {
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

  const session = await getSession();
  const includeDebug = input.source === "playground" && session?.user.id === assistant.userId;
  const persist = shouldPersistChatTranscript({
    assistant,
    source,
    sessionUserId: session?.user.id,
    assistantOwnerId: assistant.userId,
  });

  let conversationId = input.conversationId ?? createId();
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];

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

    const prior = await db()
      .select({
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    history = prior
      .filter((row) => row.role === "user" || row.role === "assistant")
      .map((row) => ({
        role: row.role as "user" | "assistant",
        content: row.content,
      }));
  } else {
    // Ephemeral id for the SSE response only — nothing is written.
    conversationId = createId();
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
    source,
  });

  if (!gate.ok) {
    return jsonWithCors(
      { error: gate.error, reason: gate.reason },
      { status: gate.status },
    );
  }

  const reservation = gate.reservation;
  const encoder = new TextEncoder();
  const assistantMessageId = createId();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(sseLine(payload)));

      try {
        let prepared = await prepareAnswer({
          db: db(),
          assistantId: assistant.id,
          instructions: assistant.instructions,
          mode: assistant.hallucinationMode,
          message: input.message,
          history,
          embedding: models.embedding,
          chat: models.chat,

          ragSettings: assistant.ragSettings,
          cohereApiKey: env.COHERE_API_KEY ?? null,
        });

        let fullText = prepared.fallbackText;
        let answerUsages = [...prepared.providerUsages];

        if (!prepared.shouldGenerate) {
          send({ type: "token", text: prepared.fallbackText });
        } else if (rag.guardrails.verifyCitations) {
          const verified = await generateVerifiedAnswer({
            prepared,
            question: input.message,
            chat: models.chat,

          });
          prepared = withVerifierResult(prepared, verified);
          fullText = verified.text;
          answerUsages = prepared.providerUsages;
          send({ type: "token", text: fullText });
        } else {
          fullText = "";
          const result = streamChat({
            config: models.chat,
            system: prepared.system,
            messages: [{ role: "user", content: input.message }],
          });

          for await (const delta of result.textStream) {
            fullText += delta;
            send({ type: "token", text: delta });
          }

          const streamUsage = await result.usage;
          answerUsages = [
            ...prepared.providerUsages,
            {
              kind: "chat_completion",
              provider: models.chat.provider,
              model: models.chat.model,
              usage: streamUsage,
              step: "stream_answer",
            },
          ];
        }

        await finishChatUsageReservation({
          reservation,
          accountId: hostingAccount.id,
          assistantId: assistant.id,
          requestId: usageRequestId,
          source,
          visitorId: input.visitorId,
          records: answerUsages,
          billing: models.billing,
        });

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
        }, source, includeDebug));
        send({ type: "done" });
      } catch (error) {
        await abortChatUsageReservation(reservation);

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
        }, source, includeDebug));
        send({ type: "done" });
      } finally {
        controller.close();
      }
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
