import { ANSWER_SCOPE_POLICY } from "./scope";
import type { AuthorizedTurn } from "./scope-router";
import { HISTORY_LOOKUP_SENTINEL } from "./turn-plan";

/**
 * Profile answer route (behind PROFILE_ANSWER_ROUTE): a latency/cost optimization
 * for basic identity, contact and hours questions that published key facts answer.
 * It runs only after the Scope Router authorized the turn, so scope never depends
 * on it; anything the facts do not fully answer falls back to normal retrieval.
 */

const BASIC_PROFILE_QUESTION = [
  /\b(who|what) (are|is) (you|this|this assistant|she|he|they|your (company|business|organi[sz]ation|team))\b/,
  /\bwhat do (you|they|she|he) do\b/,
  /\b(e-?mail|phone|telephone|contact|reach (you|her|him|them)|get in touch)\b/,
  /\b(address|located|location|where (are|is) (you|it|she|he|they)|directions)\b/,
  /\b(opening|business|office|working) hours\b|\bhours\b|\bwhen (are|is) (you|it|she|he|they) open\b|\bwhat time do (you|they) (open|close)\b/,
  /\b(website|linkedin|github|social media)\b/,
];

/** Compound requests ("…, and is there parking?") may ask for more than the facts hold. */
const COMPOUND_REQUEST = /\b(and|also|plus|as well as)\b|[,;]|\?.*\S.*\?/;

export function isBasicProfileQuestion(message: string): boolean {
  const text = message.toLowerCase().replace(/[’`]/g, "'").trim();
  if (!text || text.length > 140 || COMPOUND_REQUEST.test(text)) return false;
  return BASIC_PROFILE_QUESTION.some((pattern) => pattern.test(text));
}

export function buildProfileAnswerPrompt(
  _turn: AuthorizedTurn,
  ownerContext: string | null,
  style?: string,
): string {
  return [
    ownerContext?.trim() || "You are a helpful AI assistant.",
    "",
    "Answer the request in the current message using only the numbered key facts supplied with it (owner-approved data).",
    "Cite every fact you use with its marker, like [1]. Do not add any other fact or general knowledge.",
    `If the key facts do not fully answer the request, reply with exactly ${HISTORY_LOOKUP_SENTINEL} and nothing else.`,
    "Otherwise reply concisely, in the user's language.",
    ...(style ? [style] : []),
    "",
    ANSWER_SCOPE_POLICY,
  ].join("\n");
}
