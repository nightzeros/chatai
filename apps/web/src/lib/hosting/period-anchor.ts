/**
 * UTC start of the calendar month containing `date`.
 * Used as the default billing period anchor for new hosting accounts.
 */
export function defaultPeriodAnchor(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Current billing period bounds from an account anchor and a reference date.
 */
export function currentBillingPeriod(periodAnchor: Date, now = new Date()) {
  const anchor = new Date(periodAnchor);
  const anchorDay = anchor.getUTCDate();

  let periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), anchorDay, 0, 0, 0, 0));
  if (periodStart > now) {
    periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, anchorDay, 0, 0, 0, 0),
    );
  }

  const periodEnd = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, anchorDay, 0, 0, 0, 0),
  );

  return { periodStart, periodEnd };
}
