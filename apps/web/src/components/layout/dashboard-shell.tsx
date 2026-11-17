"use client";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { AssistantWorkspaceProvider } from "@/components/layout/assistant-workspace-context";
import { DashboardMobileNav, DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

export function DashboardShell({
  docsUrl,
  userEmail,
  children,
}: {
  docsUrl: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <AssistantWorkspaceProvider>
      <div className="flex h-svh overflow-hidden bg-background">
        <DashboardSidebar docsUrl={docsUrl} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4 md:px-6">
            <DashboardMobileNav docsUrl={docsUrl} />
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <span className="hidden max-w-[14rem] truncate text-sm text-muted-foreground md:inline">
                {userEmail}
              </span>
              <ThemeToggle compact />
              <SignOutButton />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--spacing-page)] py-5 sm:py-8 md:px-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AssistantWorkspaceProvider>
  );
}
