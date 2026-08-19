import { AccountForms } from "@/components/account/account-forms";
import { ApiKeysPanel } from "@/components/account/api-keys-panel";
import { listApiKeysForUser } from "@/lib/api-keys-data";
import { requireSession } from "@/lib/session";

export default async function AccountPage() {
  const session = await requireSession();
  const keys = await listApiKeysForUser(session.user.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your profile, API keys, password, and account deletion.
        </p>
      </div>
      <ApiKeysPanel keys={keys} />
      <AccountForms name={session.user.name} email={session.user.email} />
    </div>
  );
}
