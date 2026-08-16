import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { env } from "@/lib/env";

export default function LoginPage() {
  const githubEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        ChatAI
      </Link>
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
        <LoginForm githubEnabled={githubEnabled} />
      </Suspense>
    </main>
  );
}
