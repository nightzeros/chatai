import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { getUsageLimits } from "@/lib/hosting/usage-reports";

export async function GET() {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const limits = await getUsageLimits(auth.account);
  return NextResponse.json({ limits });
}
