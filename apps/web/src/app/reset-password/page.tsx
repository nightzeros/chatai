import Link from "next/link";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        ChatAI
      </Link>
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
