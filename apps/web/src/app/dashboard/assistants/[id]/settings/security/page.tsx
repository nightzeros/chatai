import { notFound } from "next/navigation";

import { SecurityPolicyCard } from "@/components/assistants/security-policy-card";
import { WidgetSigningCard } from "@/components/assistants/widget-signing-card";
import { PageHeader } from "@/components/ui/page-header";
import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function SecuritySettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) notFound();

  const security = assistant.securitySettings ?? {};
  const hasSigningSecret = Boolean(security.widgetSigningSecret);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Security"
        description="Domain allowlist, rate limits, and optional widget signing. Secrets are never shown in full after creation."
      />
      <SecurityPolicyCard
        assistantId={assistant.id}
        allowedDomains={security.allowedDomains ?? []}
        widgetRateLimitPerVisitor={security.widgetRateLimitPerVisitor ?? null}
        widgetRateLimitPerAssistant={security.widgetRateLimitPerAssistant ?? null}
        instanceVisitorLimit={env.WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE}
        instanceAssistantLimit={env.WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE}
      />
      <WidgetSigningCard
        assistantId={assistant.id}
        requireWidgetSigning={Boolean(security.requireWidgetSigning)}
        hasSigningSecret={hasSigningSecret}
      />
    </div>
  );
}
