/** Thrown when hosted usage reservation is denied (enforce mode). */
export class UsageLimitExceededError extends Error {
  readonly reason = "usage_limit_exceeded" as const;
  readonly status = 402 as const;

  constructor(message = "Usage limit exceeded for this billing period.") {
    super(message);
    this.name = "UsageLimitExceededError";
  }
}

export function isUsageLimitExceededError(error: unknown): error is UsageLimitExceededError {
  return error instanceof UsageLimitExceededError;
}
