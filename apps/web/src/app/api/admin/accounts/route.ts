import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/hosting/admin-auth";
import { listAdminHostingAccounts } from "@/lib/hosting/admin-accounts";

function parseLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

function parseOffset(raw: string | null): number {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = parseOffset(url.searchParams.get("offset"));
  const accounts = await listAdminHostingAccounts({ limit, offset });

  return NextResponse.json({ accounts, limit, offset });
}
