"use server";

import { assistants, eq } from "@chatai/database";
import { revalidatePath } from "next/cache";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";
import { generateWidgetSigningSecret } from "@/lib/policies/checks/widget-signature";
import { requireSession } from "@/lib/session";

export type WidgetSigningActionState =
  | { error: string }
  | { saved: true; revealedSecret?: string }
  | null;

export async function updateWidgetSigning(
  _prev: WidgetSigningActionState,
  formData: FormData,
): Promise<WidgetSigningActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const requireWidgetSigning = formData.get("requireWidgetSigning") === "on";

  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return { error: "Assistant not found." };
  }

  const current = assistant.securitySettings ?? {};
  let widgetSigningSecret = current.widgetSigningSecret ?? null;
  let revealedSecret: string | undefined;

  if (requireWidgetSigning && !widgetSigningSecret) {
    widgetSigningSecret = generateWidgetSigningSecret();
    revealedSecret = widgetSigningSecret;
  }

  await db()
    .update(assistants)
    .set({
      securitySettings: {
        ...current,
        requireWidgetSigning,
        widgetSigningSecret,
      },
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, assistant.id));

  revalidatePath(`/dashboard/assistants/${assistant.id}`);
  revalidatePath(`/dashboard/assistants/${assistant.id}/settings`);
  revalidatePath(`/dashboard/assistants/${assistant.id}/install`);

  return { saved: true, revealedSecret };
}
