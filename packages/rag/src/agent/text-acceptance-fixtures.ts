/**
 * Shared text-acceptance fixtures for M5 (and later Voice transcript parity).
 * Messages only — no secrets, no document bodies.
 */

export type TextAcceptanceFixtureId =
  | "ack"
  | "yes_after_offer"
  | "how_are_you"
  | "slang_greeting"
  | "chitchat_going"
  | "greeting_plus_ask"
  | "overview"
  | "unknown_age"
  | "off_topic";

export type TextAcceptanceFixture = {
  id: TextAcceptanceFixtureId;
  message: string;
  /** Prior assistant turn when the fixture needs conversational context. */
  priorAssistant?: string;
  /**
   * Expected production behavior class for the agent path.
   * `social` may skip Layer C / Purpose; `factual` must pass evidence gates;
   * `redirect` must not deliver the contested factual draft;
   * `not_in_knowledge` must refuse missing facts without a Purpose invite.
   */
  expect: "social" | "factual" | "redirect" | "not_in_knowledge";
};

export const TEXT_ACCEPTANCE_FIXTURES: TextAcceptanceFixture[] = [
  { id: "ack", message: "Thanks", expect: "social" },
  {
    id: "yes_after_offer",
    message: "Yes",
    priorAssistant: "Would you like an overview of their work?",
    expect: "factual",
  },
  { id: "how_are_you", message: "Hi there, how are you doing today", expect: "social" },
  { id: "slang_greeting", message: "Hey, what's good", expect: "social" },
  { id: "chitchat_going", message: "How is it going first of all", expect: "social" },
  {
    id: "greeting_plus_ask",
    message: "Hi — tell me about him",
    expect: "factual",
  },
  { id: "overview", message: "Tell me about him", expect: "factual" },
  { id: "unknown_age", message: "How old is he", expect: "not_in_knowledge" },
  { id: "off_topic", message: "Help me bake a cake", expect: "redirect" },
];

export function textAcceptanceFixture(id: TextAcceptanceFixtureId): TextAcceptanceFixture {
  const fixture = TEXT_ACCEPTANCE_FIXTURES.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`Unknown text acceptance fixture: ${id}`);
  return fixture;
}
