import { ChatWidget } from "@chatai/react";

export function App() {
  return (
    <main>
      <h1>ChatAI React widget</h1>
      <p>
        Set <code>VITE_CHATAI_ORIGIN</code> and <code>VITE_CHATAI_ASSISTANT_ID</code> in
        a local <code>.env</code> (see README). Packages stay private — use
        <code>workspace:*</code> from this monorepo.
      </p>
      <ChatWidget
        assistantId={import.meta.env.VITE_CHATAI_ASSISTANT_ID}
        apiUrl={import.meta.env.VITE_CHATAI_ORIGIN}
      />
    </main>
  );
}
