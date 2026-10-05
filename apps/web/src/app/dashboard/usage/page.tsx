import { UsageDashboard } from "@/components/account/usage-dashboard";
import { getOrCreateHostingAccount } from "@/lib/hosting/accounts";
import {
  getRecentUsageEvents,
  getUsageByAssistant,
  getUsageByModel,
  getUsageLimits,
  getUsageSummary,
} from "@/lib/hosting/usage-reports";
import { requireSession } from "@/lib/session";
import { getVoiceUsageReport } from "@/lib/voice/usage-report";

export default async function UsagePage() {
  const session = await requireSession();
  const account = await getOrCreateHostingAccount(session.user.id);

  const [summary, limits, byAssistant, byModel, recent, voice] = await Promise.all([
    getUsageSummary(account),
    getUsageLimits(account),
    getUsageByAssistant(account),
    getUsageByModel(account),
    getRecentUsageEvents(account, { limit: 50 }),
    getVoiceUsageReport(account),
  ]);

  return (
    <UsageDashboard
      summary={summary}
      limits={limits}
      byAssistant={byAssistant}
      byModel={byModel}
      recent={recent.events}
      voice={voice}
    />
  );
}
