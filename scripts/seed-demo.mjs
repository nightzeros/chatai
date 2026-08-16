/**
 * Optional demo seed — run after the app is up and DATABASE_URL is set.
 *
 *   pnpm seed:demo
 *
 * Creates demo@chatai.local / DemoPass123! with a Support Bot assistant
 * and a refund-policy text document queued for ingestion.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? "demo@chatai.local";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "DemoPass123!";
const DEMO_NAME = "Demo User";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const REFUND_POLICY = `# Refund Policy

We offer a **30-day money-back guarantee** on all paid plans.

- Refunds are processed within 5–7 business days to the original payment method.
- Usage beyond fair trial limits may reduce the refund amount.
- Contact support@example.com to start a refund request.
`;

function id(prefix = "") {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let out = prefix;
  for (let i = 0; i < 21; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function signUp() {
  const response = await fetch(`${BETTER_AUTH_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BETTER_AUTH_URL,
    },
    body: JSON.stringify({
      name: DEMO_NAME,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (response.ok) {
    return data.user.id;
  }

  if (response.status === 422 || data?.message?.includes?.("exists")) {
    const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
    const rows = await sql`select id from "user" where email = ${DEMO_EMAIL} limit 1`;
    await sql.end();
    if (rows[0]?.id) return rows[0].id;
  }

  throw new Error(data?.message ?? data?.error ?? `Sign-up failed (${response.status})`);
}

const userId = await signUp();
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

const existing = await sql`
  select id from assistants where user_id = ${userId} and name = 'Support Bot' limit 1
`;

let assistantId = existing[0]?.id;
let publicId;

if (assistantId) {
  const row = await sql`select public_id from assistants where id = ${assistantId} limit 1`;
  publicId = row[0]?.public_id;
  console.log(`[seed] Assistant already exists (${publicId}).`);
} else {
  assistantId = id();
  publicId = `asst_${Math.random().toString(36).slice(2, 12)}`;
  await sql`
    insert into assistants (
      id, public_id, user_id, name, welcome_message, instructions, hallucination_mode, settings
    ) values (
      ${assistantId},
      ${publicId},
      ${userId},
      'Support Bot',
      'Hi! How can I help you today?',
      'Answer using the knowledge base. Cite sources with [1] markers. Do not invent policies.',
      'balanced',
      '{}'::jsonb
    )
  `;
  console.log(`[seed] Created assistant ${publicId}.`);
}

const docExisting = await sql`
  select id from documents where assistant_id = ${assistantId} and name = 'Refund policy' limit 1
`;

if (docExisting[0]?.id) {
  console.log("[seed] Refund policy document already exists.");
} else {
  const documentId = id();
  await sql`
    insert into documents (
      id, assistant_id, type, name, mime_type, status, content, chunk_count
    ) values (
      ${documentId},
      ${assistantId},
      'text',
      'Refund policy',
      'text/plain',
      'pending',
      ${REFUND_POLICY},
      0
    )
  `;
  await sql`
    insert into ingest_jobs (id, document_id, status, attempts)
    values (${id()}, ${documentId}, 'pending', 0)
  `;
  console.log("[seed] Queued refund policy for ingestion.");
}

await sql.end();

console.log("");
console.log("Demo credentials:");
console.log(`  Email:    ${DEMO_EMAIL}`);
console.log(`  Password: ${DEMO_PASSWORD}`);
console.log(`  Login:    ${BETTER_AUTH_URL}/login`);
console.log(`  Playground: ${BETTER_AUTH_URL}/dashboard/assistants/${assistantId}`);
console.log("");
console.log("Set AI_API_KEY and wait for ingestion to finish before asking about refunds.");
