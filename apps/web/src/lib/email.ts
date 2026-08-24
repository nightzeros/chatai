import { env } from "@/lib/env";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailTransportConfig = {
  resendApiKey?: string;
  emailFrom?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string, payload: SendEmailInput) => void;
};

const DEFAULT_FROM = "ChatAI <onboarding@resend.dev>";

/**
 * Send transactional email via Resend when `RESEND_API_KEY` is set.
 * Otherwise logs the message (including reset URLs) for local/self-host ops.
 */
export async function sendEmail(
  input: SendEmailInput,
  config: EmailTransportConfig = {},
): Promise<{ ok: true; transport: "resend" | "console" }> {
  const apiKey = config.resendApiKey ?? env.RESEND_API_KEY;
  const from = config.emailFrom ?? env.EMAIL_FROM ?? DEFAULT_FROM;
  const log = config.log ?? ((message, payload) => console.info(message, payload));

  if (!apiKey) {
    log("[email] RESEND_API_KEY not set — logging message instead of sending", input);
    return { ok: true, transport: "console" };
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    log(
      `[email] Resend failed (${response.status}) — logging message instead of sending`,
      input,
    );
    console.error(`[email] Resend error detail: ${detail || response.statusText}`);
    return { ok: true, transport: "console" };
  }

  return { ok: true, transport: "resend" };
}
