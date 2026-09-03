import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import {
  getRecentUsageEvents,
  parseRecentLimitParam,
  parseRecentOffsetParam,
} from "@/lib/hosting/usage-reports";

export async function GET(request: Request) {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = parseRecentLimitParam(url.searchParams.get("limit"));
  const offset = parseRecentOffsetParam(url.searchParams.get("offset"));

  const result = await getRecentUsageEvents(auth.account, { limit, offset });
  return NextResponse.json(result);
}
