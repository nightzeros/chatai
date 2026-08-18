export class ChatAIError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(message: string, status: number, retryAfter?: string | null) {
    super(message);
    this.name = "ChatAIError";
    this.status = status;
    const parsed = retryAfter ? Number(retryAfter) : NaN;
    this.retryAfter = Number.isFinite(parsed) ? parsed : null;
  }
}
