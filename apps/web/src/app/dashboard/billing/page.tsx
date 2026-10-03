import { BillingDashboard, type BillingPageData } from "@/components/account/billing-dashboard";
import { getOrCreateHostingAccount } from "@/lib/hosting/accounts";
import { countAssistantsForUser } from "@/lib/hosting/assistant-limits";
import { currentPolarPlanProductMap } from "@/lib/hosting/polar/allowlist";
import { getPolar } from "@/lib/hosting/polar/client";
import {
  isHostingPlanCode,
  type HostingPlanCode,
  type PaidHostingPlanCode,
} from "@/lib/hosting/plan-catalog";
import { resolveAccountEntitlements } from "@/lib/hosting/plan-entitlements";
import { getUsageSummary } from "@/lib/hosting/usage-reports";
import { requireSession } from "@/lib/session";

export default async function BillingPage() {
  const session = await requireSession();
  const account = await getOrCreateHostingAccount(session.user.id);
  const planCode: HostingPlanCode = isHostingPlanCode(account.planCode)
    ? account.planCode
    : "free";

  const [summary, entitlements, assistantCount] = await Promise.all([
    getUsageSummary(account),
    resolveAccountEntitlements(account),
    countAssistantsForUser(session.user.id),
  ]);

  const planProducts = currentPolarPlanProductMap();
  const configuredPaidPlans = [...planProducts.keys()] as PaidHostingPlanCode[];

  let subscription: BillingPageData["subscription"] = null;
  if (account.polarSubscriptionId && getPolar()) {
    try {
      const polar = getPolar()!;
      const sub = await polar.subscriptions.get({ id: account.polarSubscriptionId });
      subscription = {
        status: sub.status,
        currentPeriodStart:
          sub.currentPeriodStart?.toISOString?.() ??
          (sub.currentPeriodStart as unknown as string | null),
        currentPeriodEnd:
          sub.currentPeriodEnd?.toISOString?.() ??
          (sub.currentPeriodEnd as unknown as string | null),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      };
    } catch (err) {
      console.warn("[billing-page] Failed to fetch subscription:", err);
    }
  }

  const data: BillingPageData = {
    planCode,
    accountStatus: account.status,
    polarConfigured: Boolean(getPolar()),
    hasSubscription: Boolean(account.polarSubscriptionId),
    polarCustomerId: account.polarCustomerId,
    subscription,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    consumedMicros: summary.consumedMicros,
    reservedMicros: summary.reservedMicros,
    limitMicros: summary.limitMicros,
    requestCount: summary.requestCount,
    monthlyRequestCap: entitlements.monthlyRequestCap,
    assistantCount,
    maxAssistants: entitlements.maxAssistants,
    usagePercent: summary.usagePercent,
    configuredPaidPlans,
    voiceSecondsUsed: summary.voice?.voiceSecondsUsed ?? 0,
    voiceSecondsLimit: summary.voice?.voiceSecondsLimit ?? null,
  };

  return <BillingDashboard data={data} />;
}
