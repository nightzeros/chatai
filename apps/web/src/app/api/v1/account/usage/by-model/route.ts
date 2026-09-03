import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { getUsageByModel } from "@/lib/hosting/usage-reports";

export async function GET() {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const byModel = await getUsageByModel(auth.account);
  return NextResponse.json({ byModel });
}
