/** Format micro-dollars as a USD string for dashboard display. */
export function formatUsdFromMicros(micros: number): string {
  const value = Number(micros) || 0;
  const dollars = value / 1_000_000;
  const abs = Math.abs(dollars);

  if (abs > 0 && abs < 0.01) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    }).format(dollars);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function formatUsageDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatUsageDay(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(iso));
}

export function usageBarTone(percent: number): "default" | "warning" | "danger" {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "default";
}

export function formatPlanCode(planCode: string): string {
  if (!planCode) return "—";
  return planCode.charAt(0).toUpperCase() + planCode.slice(1);
}
