# Polar Billing Integration

ChatAI supports paid subscription plans via [Polar](https://polar.sh) (Merchant of Record). This guide covers setup, configuration, and the subscription lifecycle.

## Prerequisites

- A [Polar organization](https://polar.sh) (sandbox works for development)
- Recurring Products created for **Starter**, **Pro**, and **Business**

## Environment Variables

```bash
POLAR_ACCESS_TOKEN=polar_oat_...
POLAR_WEBHOOK_SECRET=polar_whs_...
POLAR_SERVER=sandbox   # or production

# Allowlisted Product IDs — checkout resolves these from internal planCode
POLAR_PRODUCT_ID_STARTER=...
POLAR_PRODUCT_ID_PRO=...
POLAR_PRODUCT_ID_BUSINESS=...

# Deprecated alias: maps to Business for one release if BUSINESS is unset
# POLAR_PRODUCT_ID_TEAM=...

# Production hosted SaaS should enforce limits
HOSTED_USAGE_ENFORCEMENT=enforce
# Fallback ceiling when plan_entitlements row is missing ($1)
HOSTED_USAGE_DEFAULT_LIMIT_MICROS=1000000
```

When `POLAR_ACCESS_TOKEN` is not set, billing endpoints return `503` and the app stays free-tier + admin upgrades.

No Polar secrets may use `NEXT_PUBLIC_*`.

## Plan ladder (defaults)

Enforceable limits live in `plan_entitlements` (migration `0012`). Display prices live in `apps/web/src/lib/hosting/plan-catalog.ts` and must match Polar Products operationally.

| Plan | Display | Hosted AI | Assistants | Requests | Evals | Team-ready |
|------|---------|-----------|------------|----------|-------|------------|
| `free` | $0 | $1.00 | 1 | 75 | no | no |
| `starter` | $19 | $12.00 | 5 | 2,000 | no | no |
| `pro` | $49 | $45.00 | 20 | 15,000 | yes | no |
| `business` | $149 | $150.00 | 100 | 50,000 | yes | flag only |

Seat billing is **not** implemented. `teamMembers` is a UI/entitlement flag.

### Three Free protections

1. Provider-cost ceiling (`monthly_limit_micros`)
2. Assistant count (`features.maxAssistants`)
3. Request count (`monthly_request_cap`)

All checks are server-side.

## Polar Product Setup

1. Create recurring Products for Starter / Pro / Business; copy IDs into env.
2. Webhook endpoint: `https://your-domain.com/api/webhooks/polar`
3. Events: `checkout.updated`, `subscription.created`, `subscription.active`, `subscription.updated`, `subscription.canceled`, `subscription.revoked`, `subscription.uncanceled`, `subscription.past_due`

## Customer UI

- **`/dashboard/billing`** — plans, meters, Upgrade, Manage Billing
- **`/dashboard/usage`** — detailed spend breakdown + upgrade CTA near limits

## API

### `GET /api/v1/account/billing`

Plan, entitlements, configured products, subscription snapshot.

### `POST /api/v1/account/billing/checkout`

```json
{ "planCode": "starter" }
```

Server maps `planCode` → Polar product. **Do not send `productId` from the browser.**

### `POST /api/v1/account/billing/portal`

Requires `polarCustomerId`. Returns Polar customer portal URL.

## Lifecycle

```
Upgrade → Polar Checkout → webhook subscription.active/updated
  → hosting_accounts.plan_code + polar ids
  → usage_period_balances.limit_micros refreshed
  → entitlements enforce on next request / assistant create
```

| Event | Behavior |
|-------|----------|
| `subscription.active` / `updated` / `created` / `uncanceled` | Sync plan from allowlisted product; refresh period limit |
| `subscription.canceled` / `revoked` (terminal) | `plan_code = free`, clear subscription id |
| Cancel at period end (`cancel_at_period_end`) | Keep paid until Polar status is terminal |
| `subscription.past_due` | Audit only — no immediate downgrade |
| Unknown product | Do **not** grant a paid plan |

### Idempotency

Events claimed in `polar_events` by webhook id before processing. Failures release the claim and return `500` for Polar retry.

## Admin

`PATCH /api/admin/accounts/:id` may set `status`, `limitOverrideMicros`, and/or `planCode` (support override; audit-logged). Credits still raise the effective ceiling for the current period.

## Document / ingest note

Upload size is capped (20 MB). Embedding spend shares the same monthly hosted AI budget + request cap. There is no separate Free document quota in v1.

## Eval metering

`evalsEnabled` is enforced on eval-run APIs. Each offline/online eval job **reserves** estimated hosted cost before provider calls and **reconciles** actual token usage afterward (same ledger as chat/ingest). Limit-exceeded jobs fail without retry.

## Self-hosted / BYOK

Self-hosted instances typically leave Polar unset and use `HOSTED_USAGE_ENFORCEMENT=off` or their own keys. Full BYOK productization is out of scope for this billing UI.

## Migration notes (`0012`)

- Inserts/updates `free` / `starter` / `pro` / `business` entitlements
- Migrates `hosting_accounts.plan_code` `team` → `business`
- Deletes legacy `team` entitlement row
- Refreshes current-period `limit_micros` for accounts without overrides (does **not** reset spend)

## Local development

Use `POLAR_SERVER=sandbox`, expose the app (e.g. ngrok), register the webhook URL, and copy the sandbox signing secret.
