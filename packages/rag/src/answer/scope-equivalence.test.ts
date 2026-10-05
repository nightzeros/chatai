import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerateChatFn } from "@chatai/ai";
import type { Database } from "@chatai/database";

import { prepareAnswer } from "./answer";
import type { ChatHistoryMessage } from "./turn-plan";

/**
 * Text and Voice make the same scope decision: both call prepareAnswer with the same
 * scope inputs. The only Voice difference is `responseStyle` (spoken output), which
 * never reaches the classifier. The route/orchestrator tests prove each caller passes
 * these inputs and emits `fallbackText` verbatim.
 */

const embedMany = vi.fn();
const retrieveChunks = vi.fn();

vi.mock("@chatai/ai", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  embedMany: (...args: unknown[]) => embedMany(...args),
}));

vi.mock("./retrieve", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  retrieveChunks: (...args: unknown[]) => retrieveChunks(...args),
}));

const chat = { apiKey: "test", baseURL: "https://example.com/v1", model: "test" };
const embedding = { apiKey: "test", baseURL: "https://example.com/v1", model: "embed", dimensions: 2 };
const CLINIC =
  "You are the virtual receptionist for Bright Smile Dental Clinic. You help patients with appointments, services and opening hours.";
const VOICE_STYLE = "\nThe answer will be spoken aloud: no markdown, short sentences.";

const history: ChatHistoryMessage[] = [
  { role: "user", content: "When are you open?" },
  { role: "assistant", content: "Monday to Friday, 8am to 6pm [1].", grounded: true },
];

type Case = { name: string; message: string; history: ChatHistoryMessage[]; planner: string | Error };

const cases: Case[] = [
  { name: "in scope", message: "Do you do whitening?", history, planner: '{"route":"knowledge","scope":"in","query":"Bright Smile whitening"}' },
  { name: "first turn in scope", message: "Do you do whitening?", history: [], planner: '{"route":"knowledge","scope":"in","query":"whitening"}' },
  {
    name: "unrelated, classifier redirect",
    message: "Who won the match last night?",
    history,
    planner: '{"route":"knowledge","scope":"out","query":"match","redirect":"I can help with appointments and services at the clinic."}',
  },
  {
    name: "unrelated first turn, template redirect",
    message: "Write me a poem",
    history: [],
    planner: '{"route":"knowledge","scope":"out","query":"poem"}',
  },
  { name: "mixed", message: "Hours, and a good laptop?", history, planner: '{"route":"knowledge","scope":"partial","query":"Bright Smile hours"}' },
  { name: "classifier failure", message: "Do you do whitening?", history, planner: new Error("down") },
  { name: "social protocol", message: "Thanks!", history, planner: '{"route":"knowledge","scope":"out","query":"x"}' },
];

function model(planner: string | Error) {
  return vi.fn(async (args: { system: string; prompt?: string }) => {
    if (args.prompt?.includes('"latestMessage":')) {
      if (planner instanceof Error) throw planner;
      return planner;
    }
    return "Reply [1].";
  });
}

async function run(c: Case, responseStyle?: string) {
  const generateChat = model(c.planner);
  const prepared = await prepareAnswer({
    db: {} as Database,
    assistantId: "asst-clinic",
    assistantName: "Smile Desk",
    instructions: CLINIC,
    mode: "balanced",
    message: c.message,
    history: c.history,
    embedding,
    chat,
    ragSettings: { queryExpansion: false, rerank: false, hybridSearch: false },
    ...(responseStyle ? { responseStyle } : {}),
    deps: { generateChat: generateChat as unknown as GenerateChatFn, loadKnowledgeTitles: async () => ["Opening hours"] },
  });
  const classifierInput = generateChat.mock.calls
    .map(([args]) => args)
    .filter((args) => args.prompt?.includes('"latestMessage":'))
    .map((args) => ({ system: args.system, prompt: args.prompt }));
  return { prepared, classifierInput };
}

beforeEach(() => {
  embedMany.mockReset().mockResolvedValue({ embeddings: [[0.1, 0.2]], usage: { tokens: 3 } });
  retrieveChunks.mockReset().mockResolvedValue([
    { chunkId: "c1", documentId: "d1", documentName: "Opening hours", content: "Open 8 to 6.", similarity: 0.9 },
  ]);
});

describe("Text and Voice scope equivalence", () => {
  it.each(cases)("$name: identical decision, outcome and redirect", async (c) => {
    const text = await run(c);
    const voice = await run(c, VOICE_STYLE);

    expect(voice.classifierInput).toEqual(text.classifierInput);
    expect(voice.prepared.scope?.decision).toBe(text.prepared.scope?.decision);
    expect(voice.prepared.outcome).toBe(text.prepared.outcome);
    expect(voice.prepared.shouldGenerate).toBe(text.prepared.shouldGenerate);
    expect(voice.prepared.query).toBe(text.prepared.query);
    if (!text.prepared.shouldGenerate && text.prepared.outcome !== "conversational") {
      expect(voice.prepared.fallbackText).toBe(text.prepared.fallbackText);
    }
  });

  it("covers every scope decision", async () => {
    const decisions = new Set<string>();
    for (const c of cases) decisions.add((await run(c)).prepared.scope?.decision ?? "none");
    expect([...decisions].sort()).toEqual(["in", "out", "partial", "unknown"]);
  });
});
