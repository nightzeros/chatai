import Link from "next/link";

import { SignupForm } from "@/components/auth/signup-form";
import { env } from "@/lib/env";

export default function SignupPage() {
  const githubEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        ChatAI
      </Link>
      <SignupForm githubEnabled={githubEnabled} />
    </main>
  );
}
