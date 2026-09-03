import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { getUsageSummary } from "@/lib/hosting/usage-reports";

export async function GET() {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const summary = await getUsageSummary(auth.account);
  return NextResponse.json({ summary });
}
