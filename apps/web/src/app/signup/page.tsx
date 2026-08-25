import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { env } from "@/lib/env";

export default function SignupPage() {
  const githubEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

  return (
    <AuthShell title="Create your account" description="Start building assistants on your knowledge.">
      <SignupForm githubEnabled={githubEnabled} />
    </AuthShell>
  );
}
