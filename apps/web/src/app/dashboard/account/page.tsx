import { AccountForms } from "@/components/account/account-forms";
import { AboutCard } from "@/components/account/about-card";
import { ApiKeysPanel } from "@/components/account/api-keys-panel";
import { AuditLogPanel } from "@/components/account/audit-log-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Separator } from "@/components/ui/separator";
import { listApiKeysForUser } from "@/lib/api-keys-data";
import { listAuditEventsForUser } from "@/lib/audit/list-audit-events";
import { requireSession } from "@/lib/session";

export default async function AccountPage() {
  const session = await requireSession();
  const [keys, auditEvents] = await Promise.all([
    listApiKeysForUser(session.user.id),
    listAuditEventsForUser(session.user.id, { limit: 50 }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Account"
        description="Profile, appearance, API keys, audit log, and account deletion."
      />

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Dashboard theme. The embeddable widget theme stays independent.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">API keys</h2>
        <ApiKeysPanel keys={keys} />
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Audit log</h2>
        <AuditLogPanel events={auditEvents} />
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Profile & security</h2>
        <AccountForms name={session.user.name} email={session.user.email} />
      </section>

      <Separator />

      <AboutCard />
    </div>
  );
}
