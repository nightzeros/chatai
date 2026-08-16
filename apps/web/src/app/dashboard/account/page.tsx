import { AccountForms } from "@/components/account/account-forms";
import { requireSession } from "@/lib/session";

export default async function AccountPage() {
  const session = await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-muted-foreground">Manage your profile, password, and account deletion.</p>
      </div>
      <AccountForms name={session.user.name} email={session.user.email} />
    </div>
  );
}
