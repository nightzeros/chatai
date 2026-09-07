export function shouldGrantPaidPlan(status: string): boolean {
  return status === "active" || status === "trialing";
}

export function shouldRevertToFree(status: string): boolean {
  return (
    status === "canceled" ||
    status === "unpaid" ||
    status === "incomplete_expired" ||
    status === "paused"
  );
}
