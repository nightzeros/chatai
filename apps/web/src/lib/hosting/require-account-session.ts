import { NextResponse } from "next/server";

import type { Session } from "@/lib/auth";
import {
  getOrCreateHostingAccount,
  type HostingAccount,
} from "@/lib/hosting/accounts";
import { getSession } from "@/lib/session";

export type AccountSession =
  | { ok: true; session: Session; account: HostingAccount }
  | { ok: false; response: NextResponse };

/** Session cookie auth for account usage APIs (JSON 401, not redirect). */
export async function requireAccountSession(): Promise<AccountSession> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const account = await getOrCreateHostingAccount(session.user.id);
  return { ok: true, session, account };
}
