import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        ChatAI
      </Link>
      <ForgotPasswordForm />
    </main>
  );
}
