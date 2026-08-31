import { ChatAI, ChatAIError } from "@nightzeros/chatai-sdk";

const apiKey = process.env.CHATAI_API_KEY;
const assistantId = process.env.CHATAI_ASSISTANT_ID;
const baseUrl = process.env.CHATAI_API_URL ?? "http://localhost:3000";
const message = process.argv.slice(2).join(" ").trim() || "What is your refund policy?";

if (!apiKey || !assistantId) {
  console.error(`Usage:
  CHATAI_API_KEY=sk_live_... CHATAI_ASSISTANT_ID=asst_... pnpm start -- "your question"

Optional:
  CHATAI_API_URL   ChatAI origin (default http://localhost:3000)

Create an API key with the chat scope in Dashboard → Account.`);
  process.exit(1);
}

const client = new ChatAI({ apiKey, baseUrl });

try {
  process.stdout.write("Assistant: ");
  const result = await client.chat({
    assistantId,
    message,
    onToken: (text) => process.stdout.write(text),
  });
  process.stdout.write("\n\n");
  console.log(`conversationId=${result.conversationId} outcome=${result.outcome ?? "unknown"}`);
} catch (error) {
  if (error instanceof ChatAIError) {
    console.error(`ChatAI error (${error.status}): ${error.message}`);
    if (error.retryAfter) {
      console.error(`Retry after ${error.retryAfter}s`);
    }
    process.exit(1);
  }
  throw error;
}
