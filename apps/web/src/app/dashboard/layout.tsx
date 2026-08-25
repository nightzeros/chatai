import { SignOutButton } from "@/components/auth/sign-out-button";
import { DashboardMobileNav, DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { getDocsUrl } from "@/lib/docs-url";
import { requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const docsUrl = getDocsUrl();

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar email={session.user.email} docsUrl={docsUrl} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-6">
          <DashboardMobileNav docsUrl={docsUrl} />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 py-8 md:px-6">{children}</main>
      </div>
    </div>
  );
}
