import type { FaqPayload } from "./add-answer";

export async function submitFaq(fetcher: typeof fetch, assistantId: string, payload: FaqPayload) {
  const response = await fetcher(`/api/assistants/${assistantId}/documents/faq`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    return { ok: false as const, error: data.error ?? "Could not add the answer." };
  }
  return { ok: true as const };
}
