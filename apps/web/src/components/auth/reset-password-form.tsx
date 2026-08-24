"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const tokenError = searchParams.get("error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const invalidLink = Boolean(tokenError) || !token;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is invalid or missing a token.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    const { error: resetError } = await resetPassword({
      newPassword: password,
      token,
    });
    setPending(false);

    if (resetError) {
      setError(resetError.message || "Could not reset password.");
      return;
    }

    router.push("/login");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>
          {invalidLink
            ? "This reset link is invalid or has expired. Request a new one."
            : "Choose a new password for your ChatAI account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {invalidLink ? (
          <Link href="/forgot-password" className={cn(buttonVariants())}>
            Request a new link
          </Link>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Update password"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/login">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
