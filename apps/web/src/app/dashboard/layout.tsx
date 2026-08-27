import { SignOutButton } from "@/components/auth/sign-out-button";
import { DashboardMobileNav, DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { getDocsUrl } from "@/lib/docs-url";
import { requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const docsUrl = getDocsUrl();

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar docsUrl={docsUrl} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-border px-3 sm:px-4 md:px-6">
          <DashboardMobileNav docsUrl={docsUrl} />
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span className="hidden max-w-[14rem] truncate text-sm text-muted-foreground md:inline">
              {session.user.email}
            </span>
            <ThemeToggle compact />
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-[var(--spacing-page)] py-5 sm:py-8 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
