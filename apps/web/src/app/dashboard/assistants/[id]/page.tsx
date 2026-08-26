import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { getAssistantOverview } from "@/lib/assistant-overview";
import { requireSession } from "@/lib/session";

export default async function AssistantOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const overview = await getAssistantOverview(session.user.id, id);

  if (!overview) {
    notFound();
  }

  const {
    assistant,
    knowledgeTotal,
    documentCounts,
    sourceCounts,
    conversationTotal,
    answered,
    unanswered,
    recentConversations,
    requireWidgetSigning,
    hasSigningSecret,
  } = overview;

  const settings = assistant.settings ?? {};
  const customized =
    Boolean(settings.primaryColor) ||
    Boolean(settings.iconUrl) ||
    (settings.suggestedQuestions?.filter(Boolean).length ?? 0) > 0 ||
    settings.theme === "dark" ||
    settings.theme === "light" ||
    settings.position === "bottom-left" ||
    settings.showSources === false;

  const checklist = [
    {
      done: knowledgeTotal > 0,
      label: "Add knowledge",
      href: `/dashboard/assistants/${assistant.id}/knowledge`,
      hint: "Upload documents or crawl a website",
    },
    {
      done: conversationTotal > 0,
      label: "Try the playground",
      href: `/dashboard/assistants/${assistant.id}/playground`,
      hint: "Ask a question and inspect retrieval",
    },
    {
      done: customized,
      label: "Customize the widget",
      href: `/dashboard/assistants/${assistant.id}/customize`,
      hint: "Colors, theme, and suggested questions",
    },
    {
      done: false,
      optional: true,
      label: "Copy the install snippet",
      href: `/dashboard/assistants/${assistant.id}/install`,
      hint: "Embed on your site when you are ready",
    },
    {
      done: requireWidgetSigning ? hasSigningSecret : false,
      optional: !requireWidgetSigning,
      label: requireWidgetSigning ? "Signing enabled" : "Review security",
      href: `/dashboard/assistants/${assistant.id}/settings/security`,
      hint: requireWidgetSigning
        ? "Widget signing is required for embeds"
        : "Optional: domain allowlist, rate limits, signing",
    },
  ];

  const setupDone = checklist.filter((c) => c.done || c.optional).length;
  const setupTotal = checklist.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Overview"
        description="Status, recent activity, and a short setup path for this assistant."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/assistants/${assistant.id}/playground`}>Open playground</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Knowledge items"
          value={knowledgeTotal}
          hint={`${documentCounts.ready + sourceCounts.ready} ready · ${documentCounts.processing + sourceCounts.processing} processing`}
        />
        <StatCard label="Conversations" value={conversationTotal} />
        <StatCard label="Answered" value={answered} tone="success" />
        <StatCard
          label="Unanswered"
          value={unanswered}
          tone={unanswered > 0 ? "warning" : "default"}
          hint="Fallback or low-confidence replies"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Setup checklist</CardTitle>
            <CardDescription>
              {setupDone}/{setupTotal} complete
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {checklist.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-accent/40"
              >
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </div>
                <Badge variant={item.done ? "success" : item.optional ? "secondary" : "outline"}>
                  {item.done ? "Done" : item.optional ? "Optional" : "Todo"}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
            <div>
              <CardTitle className="text-base">Recent conversations</CardTitle>
              <CardDescription>Latest activity across playground, widget, and API</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/assistants/${assistant.id}/conversations`}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentConversations && recentConversations.length > 0 ? (
              <ul className="divide-y divide-border">
                {recentConversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/dashboard/assistants/${assistant.id}/conversations/${c.id}`}
                      className="flex flex-col gap-0.5 py-2.5 transition-colors hover:bg-accent/30"
                    >
                      <span className="line-clamp-1 text-sm">{c.preview || "No messages yet"}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.sourceLabel} · {c.outcome ?? "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                className="border-0 bg-transparent py-8"
                title="No conversations yet"
                description="Chat in the playground or install the widget to see activity here."
                action={
                  <Button asChild size="sm">
                    <Link href={`/dashboard/assistants/${assistant.id}/playground`}>Open playground</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Deploy status</CardTitle>
          <CardDescription>Flags that affect embeds and signed installs</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant={requireWidgetSigning ? "info" : "secondary"}>
            Signing {requireWidgetSigning ? "required" : "optional"}
          </Badge>
          <Badge variant={hasSigningSecret ? "success" : "outline"}>
            {hasSigningSecret ? "Signing secret set" : "No signing secret"}
          </Badge>
          <Badge variant={documentCounts.failed + sourceCounts.failed > 0 ? "danger" : "success"}>
            {documentCounts.failed + sourceCounts.failed > 0
              ? `${documentCounts.failed + sourceCounts.failed} knowledge failures`
              : "Knowledge healthy"}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
