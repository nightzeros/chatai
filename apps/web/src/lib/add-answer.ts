export type FaqPayload = {
  question: string;
  answer: string;
};

export function buildFaqPayload(questionInput: string, answerInput: string): FaqPayload | { error: string } {
  const question = questionInput.trim();
  const answer = answerInput.trim();

  if (!question) return { error: "A question is required." };
  if (!answer) return { error: "An answer is required." };
  if (question.length > 500) return { error: "Questions must be 500 characters or fewer." };
  if (answer.length > 20_000) return { error: "Answers must be 20,000 characters or fewer." };

  return { question, answer };
}
