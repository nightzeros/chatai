import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { getUsageByAssistant } from "@/lib/hosting/usage-reports";

export async function GET() {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const byAssistant = await getUsageByAssistant(auth.account);
  return NextResponse.json({ byAssistant });
}
