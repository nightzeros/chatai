import { describe, expect, it, vi } from "vitest";

import { submitFaq } from "./submit-faq";

describe("submitFaq", () => {
  it("posts the validated FAQ payload to the assistant knowledge endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, documentId: "doc-1" }));

    await expect(
      submitFaq(fetcher, "assistant-1", {
        question: "What is your refund policy?",
        answer: "Refunds are available for 30 days.",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetcher).toHaveBeenCalledWith("/api/assistants/assistant-1/documents/faq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "What is your refund policy?",
        answer: "Refunds are available for 30 days.",
      }),
    });
  });

  it("returns the API error without throwing on a rejected FAQ response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: "Assistant not found." }, { status: 404 }),
    );

    await expect(
      submitFaq(fetcher, "assistant-1", { question: "Question", answer: "Answer" }),
    ).resolves.toEqual({ ok: false, error: "Assistant not found." });
  });
});
