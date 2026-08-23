"use client";

import { ChatWidget } from "@chatai/react";

export function PortfolioChat() {
  const assistantId = process.env.NEXT_PUBLIC_CHATAI_ASSISTANT_ID?.trim();
  const apiUrl = (process.env.NEXT_PUBLIC_CHATAI_API_URL || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );

  if (!assistantId || assistantId === "asst_replace_me") {
    return (
      <aside className="chat-hint" aria-label="Chat setup">
        <p>
          Set <code>NEXT_PUBLIC_CHATAI_ASSISTANT_ID</code> in{" "}
          <code>.env.local</code> (copy from <code>.env.example</code>), then restart{" "}
          <code>pnpm dev</code>.
        </p>
      </aside>
    );
  }

  return <ChatWidget assistantId={assistantId} apiUrl={apiUrl} theme="system" />;
}
