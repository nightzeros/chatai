import { ChatWidget } from "@nightzeros/chatai-react";

const assistantId = import.meta.env.VITE_CHATAI_ASSISTANT_ID;
const apiUrl = import.meta.env.VITE_CHATAI_ORIGIN || "http://localhost:3000";

export function App() {
  return (
    <main>
      <h1>ChatAI React widget</h1>
      <p>
        Set <code>VITE_CHATAI_ASSISTANT_ID</code> (and optionally{" "}
        <code>VITE_CHATAI_ORIGIN</code>) in <code>examples/react-widget/.env</code>.
        Copy the assistant public ID from Dashboard → Install.
      </p>
      {assistantId ? (
        <ChatWidget assistantId={assistantId} apiUrl={apiUrl} />
      ) : (
        <p>
          Missing <code>VITE_CHATAI_ASSISTANT_ID</code>. Create{" "}
          <code>examples/react-widget/.env</code> from <code>.env.example</code>, then
          restart the Vite dev server.
        </p>
      )}
    </main>
  );
}
