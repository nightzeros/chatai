import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/hosting/admin-auth";
import {
  creditHostingAccountAsAdmin,
  serializeHostingAccount,
} from "@/lib/hosting/admin-accounts";

const creditSchema = z.object({
  creditMicros: z.number().int().positive(),
});

type RouteContext = { params: Promise<{ accountId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { accountId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = creditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid credit.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const account = await creditHostingAccountAsAdmin({
      accountId,
      actorUserId: auth.session.user.id,
      creditMicros: parsed.data.creditMicros,
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ account: serializeHostingAccount(account) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Credit failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
