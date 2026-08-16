import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-56 shrink-0 border-r border-border md:flex md:flex-col">
        <div className="flex h-14 items-center px-5">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            ChatAI
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          <Link
            href="/dashboard"
            className="rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Assistants
          </Link>
          <Link
            href="/dashboard/account"
            className="rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Account
          </Link>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-6">
          <nav className="flex items-center gap-4 md:hidden">
            <Link href="/dashboard" className="text-sm font-semibold">
              ChatAI
            </Link>
            <Link href="/dashboard" className="text-sm text-muted-foreground">
              Assistants
            </Link>
            <Link href="/dashboard/account" className="text-sm text-muted-foreground">
              Account
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:px-6">{children}</main>
      </div>
    </div>
  );
}
