import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset password" description="We will email you a link if an account exists.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
