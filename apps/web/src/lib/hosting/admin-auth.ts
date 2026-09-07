import { NextResponse } from "next/server";

import type { Session } from "@/lib/auth";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

export function parseAdminUserIds(raw: string = env.ADMIN_USER_IDS): string[] {
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdminUserId(
  userId: string,
  adminIds: readonly string[] = parseAdminUserIds(),
): boolean {
  return adminIds.includes(userId);
}

export type AdminSession =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

/** Session + ADMIN_USER_IDS gate for /api/admin/* routes. */
export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  if (!isAdminUserId(session.user.id)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return { ok: true, session };
}
