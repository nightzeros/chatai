"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type AccountFormsProps = {
  name: string;
  email: string;
};

export function AccountForms({ name: initialName, email }: AccountFormsProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [namePending, setNamePending] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);

  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  async function onUpdateName(e: React.FormEvent) {
    e.preventDefault();
    setNameMessage(null);
    setNamePending(true);
    const { error } = await authClient.updateUser({ name });
    setNamePending(false);
    if (error) {
      setNameMessage(error.message || "Could not update name.");
      return;
    }
    setNameMessage("Name updated.");
    router.refresh();
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    setPasswordPending(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPasswordPending(false);
    if (error) {
      setPasswordError(error.message || "Could not change password.");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setPasswordMessage("Password changed.");
  }

  async function onDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDeleteError(null);
    if (
      !window.confirm(
        "Permanently delete your account and all assistants, documents, and conversations? This cannot be undone.",
      )
    ) {
      return;
    }

    setDeletePending(true);
    const { error } = await authClient.deleteUser({
      password: deletePassword,
    });
    setDeletePending(false);

    if (error) {
      setDeleteError(error.message || "Could not delete account.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update how your name appears in the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onUpdateName}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {nameMessage ? <p className="text-sm text-muted-foreground">{nameMessage}</p> : null}
            <Button type="submit" disabled={namePending} className="w-fit">
              {namePending ? "Saving…" : "Save name"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Change your password and sign out other sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onChangePassword}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            {passwordError ? <p className="text-sm text-destructive">{passwordError}</p> : null}
            {passwordMessage ? <p className="text-sm text-muted-foreground">{passwordMessage}</p> : null}
            <Button type="submit" disabled={passwordPending} className="w-fit">
              {passwordPending ? "Updating…" : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete your account. Assistants, knowledge, and conversations are removed via cascade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onDeleteAccount}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="deletePassword">Confirm with your password</Label>
              <Input
                id="deletePassword"
                type="password"
                autoComplete="current-password"
                required
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
            {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
            <Button type="submit" variant="destructive" disabled={deletePending} className="w-fit">
              {deletePending ? "Deleting…" : "Delete account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
