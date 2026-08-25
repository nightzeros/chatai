import { AccountForms } from "@/components/account/account-forms";
import { ApiKeysPanel } from "@/components/account/api-keys-panel";
import { AuditLogPanel } from "@/components/account/audit-log-panel";
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your profile, API keys, password, audit log, and account deletion.
        </p>
      </div>
      <ApiKeysPanel keys={keys} />
      <AuditLogPanel events={auditEvents} />
      <AccountForms name={session.user.name} email={session.user.email} />
    </div>
  );
}
