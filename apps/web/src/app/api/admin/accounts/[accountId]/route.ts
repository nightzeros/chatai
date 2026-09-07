import { HOSTING_ACCOUNT_STATUSES } from "@chatai/database";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/hosting/admin-auth";
import {
  patchHostingAccountAsAdmin,
  serializeHostingAccount,
} from "@/lib/hosting/admin-accounts";

const patchSchema = z
  .object({
    status: z.enum(HOSTING_ACCOUNT_STATUSES).optional(),
    limitOverrideMicros: z.number().int().nonnegative().nullable().optional(),
    planCode: z.enum(["free", "starter", "pro", "business"]).optional(),
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      body.limitOverrideMicros !== undefined ||
      body.planCode !== undefined,
    { message: "Provide status, limitOverrideMicros, and/or planCode." },
  );

type RouteContext = { params: Promise<{ accountId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { accountId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid patch.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const account = await patchHostingAccountAsAdmin({
    accountId,
    actorUserId: auth.session.user.id,
    patch: parsed.data,
  });

  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({ account: serializeHostingAccount(account) });
}
