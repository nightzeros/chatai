import { streamChat } from "@chatai/ai";
import {
  assistants,
  asc,
  conversations,
  eq,
  messages,
  type ConversationSource,
} from "@chatai/database";
import { finalizeAnswer, prepareAnswer } from "@chatai/rag/answer";
import { z } from "zod";

import { chatConfig, embeddingConfig } from "@/lib/ai-config";
import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { createId } from "@/lib/ids";
import { publicChatMeta } from "@/lib/public-chat-meta";
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

  const [assistant] = await db()
    .select()
    .from(assistants)
    .where(eq(assistants.publicId, input.assistantId))
    .limit(1);

  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const session = await getSession();
  const includeDebug = input.source === "playground" && session?.user.id === assistant.userId;

  let conversationId = input.conversationId;
  if (conversationId) {
    const [existing] = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!existing || existing.assistantId !== assistant.id) {
      return jsonWithCors({ error: "Conversation not found." }, { status: 404 });
    }
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

  const history = prior
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
    }));

  const userMessageId = createId();
  await db().insert(messages).values({
    id: userMessageId,
    conversationId,
    role: "user",
    content: input.message,
  });

  const encoder = new TextEncoder();
  const assistantMessageId = createId();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(sseLine(payload)));

      try {
        const prepared = await prepareAnswer({
          db: db(),
          assistantId: assistant.id,
          instructions: assistant.instructions,
          mode: assistant.hallucinationMode,
          message: input.message,
          history,
          embedding: embeddingConfig(),
          chat: chatConfig(),
        });

        let fullText = prepared.fallbackText;

        if (!prepared.shouldGenerate) {
          send({ type: "token", text: prepared.fallbackText });
        } else {
          fullText = "";
          const result = streamChat({
            config: chatConfig(),
            system: prepared.system,
            messages: [{ role: "user", content: input.message }],
          });

          for await (const delta of result.textStream) {
            fullText += delta;
            send({ type: "token", text: delta });
          }
        }

        const latencyMs = Date.now() - started;
        const final = finalizeAnswer(fullText, {
          ...prepared,
          debug: { ...prepared.debug, latencyMs, model: chatConfig().model },
        });

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

        await db()
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));

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
        const message = error instanceof Error ? error.message : "Model failed.";
        const latencyMs = Date.now() - started;

        await db().insert(messages).values({
          id: assistantMessageId,
          conversationId,
          role: "assistant",
          content: "I ran into a problem generating a response. Please try again.",
          sources: [],
          confidence: 0,
          outcome: "model_failure",
          debug: { model: chatConfig().model, latencyMs, error: message },
          latencyMs,
        });

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
