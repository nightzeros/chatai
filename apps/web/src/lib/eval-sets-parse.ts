export function parseEvalSetName(name: unknown) {
  if (typeof name !== "string" || name.trim().length === 0) {
    return { error: "Name is required." };
  }
  const trimmed = name.trim();
  if (trimmed.length > 120) {
    return { error: "Name must be 120 characters or fewer." };
  }
  return { name: trimmed };
}

export function parseEvalCaseInput(input: { question?: unknown; expectedAnswer?: unknown }) {
  if (typeof input.question !== "string" || input.question.trim().length === 0) {
    return { error: "Question is required." };
  }
  const question = input.question.trim();
  if (question.length > 2000) {
    return { error: "Question must be 2000 characters or fewer." };
  }

  let expectedAnswer: string | null = null;
  if (typeof input.expectedAnswer === "string") {
    const trimmed = input.expectedAnswer.trim();
    if (trimmed.length > 8000) {
      return { error: "Expected answer must be 8000 characters or fewer." };
    }
    expectedAnswer = trimmed.length ? trimmed : null;
  }

  return { question, expectedAnswer };
}
