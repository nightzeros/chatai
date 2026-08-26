"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

export function LoginForm({ githubEnabled }: { githubEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const { error: signInError } = await signIn.email({
      email,
      password,
    });

    setPending(false);

    if (signInError) {
      setError(signInError.message || "Invalid email or password.");
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function onGithub() {
    setError(null);
    await signIn.social({
      provider: "github",
      callbackURL: next,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password">Password</Label>
              <Link
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
                href="/forgot-password"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {githubEnabled ? (
          <>
            <div className="relative py-1 text-center text-xs text-muted-foreground">
              <span className="relative z-10 bg-card/90 px-2">or</span>
              <div className="absolute inset-x-0 top-1/2 border-t border-border" />
            </div>
            <Button type="button" variant="outline" onClick={onGithub}>
              Continue with GitHub
            </Button>
          </>
        ) : null}

        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/signup">
            Sign up
          </Link>
        </p>
    </div>
  );
}
