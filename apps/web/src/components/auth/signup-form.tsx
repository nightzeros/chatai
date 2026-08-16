"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";

export function SignupForm({ githubEnabled }: { githubEnabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const { error: signUpError } = await signUp.email({
      name,
      email,
      password,
    });

    setPending(false);

    if (signUpError) {
      setError(signUpError.message || "Could not create account.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function onGithub() {
    setError(null);
    await signIn.social({
      provider: "github",
      callbackURL: "/dashboard",
    });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>Start building AI assistants on your knowledge.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </Button>
        </form>

        {githubEnabled ? (
          <>
            <div className="relative py-1 text-center text-xs text-muted-foreground">
              <span className="bg-card px-2 relative z-10">or</span>
              <div className="absolute inset-x-0 top-1/2 border-t border-border" />
            </div>
            <Button type="button" variant="outline" onClick={onGithub}>
              Continue with GitHub
            </Button>
          </>
        ) : null}

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/login">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
