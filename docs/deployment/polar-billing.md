# Polar Billing Integration

ChatAI supports paid subscription plans via [Polar](https://polar.sh) (Merchant of Record). This guide covers setup, configuration, and the subscription lifecycle.

## Prerequisites

- A [Polar organization](https://polar.sh) (sandbox works for development)
- Recurring Products created for Pro and Team

## Environment Variables

Add these to your `.env`:

```bash
# Polar organization access token
POLAR_ACCESS_TOKEN=polar_oat_...

# Webhook signing secret — from Polar Dashboard → Settings → Webhooks
POLAR_WEBHOOK_SECRET=polar_whs_...

# sandbox | production (default: sandbox)
POLAR_SERVER=sandbox

# Allowlisted Product IDs. Checkout rejects any other product.
POLAR_PRODUCT_ID_PRO=...
POLAR_PRODUCT_ID_TEAM=...
```

When `POLAR_ACCESS_TOKEN` is not set, all billing endpoints return `503` and the system operates in free-tier-only mode. Checkout also returns `503` until at least one product ID is configured.

## Polar Product Setup

### 1. Create Products in Polar Dashboard

Create a recurring Product for each plan tier. Copy each Product ID into the matching env var above.

### 2. Plan Tiers (seeded in migration 0010)

| Plan | Monthly Limit | Features |
|---|---|---|
| `free` | $5.00 | — |
| `pro` | $25.00 | evals, 20 assistants |
| `team` | $100.00 | evals, 100 assistants, team members |

### 3. Webhook Endpoint

In Polar Dashboard → Settings → Webhooks, add an endpoint:

- **URL:** `https://your-domain.com/api/webhooks/polar`
- **Events:**
  - `checkout.updated`
  - `subscription.created`
  - `subscription.active`
  - `subscription.updated`
  - `subscription.canceled`
  - `subscription.revoked`
  - `subscription.uncanceled`
  - `subscription.past_due`

Copy the signing secret to `POLAR_WEBHOOK_SECRET`.

## API Endpoints

### `GET /api/v1/account/billing`

Returns current billing status (session auth required).

```json
{
  "planCode": "pro",
  "effectiveLimitMicros": 25000000,
  "polarConfigured": true,
  "hasSubscription": true,
  "subscription": {
    "id": "…",
    "status": "active",
    "currentPeriodStart": "…",
    "currentPeriodEnd": "…",
    "cancelAtPeriodEnd": false,
    "productId": "…"
  }
}
```

### `POST /api/v1/account/billing/checkout`

Creates a Polar Checkout Session for upgrading.

```json
{ "productId": "…" }
```

`productId` must match `POLAR_PRODUCT_ID_PRO` or `POLAR_PRODUCT_ID_TEAM`. Optional `successUrl` must be same-origin (or a relative path). Default: `/dashboard/usage?checkout_id={CHECKOUT_ID}`.

Returns `{ "url": "https://…polar.sh/…" }`.

### `POST /api/v1/account/billing/portal`

Creates a Polar Customer Portal session.

```json
{ "returnUrl": "/dashboard/usage" }
```

`returnUrl` must be same-origin. Returns `{ "url": "…" }`.

## Subscription Lifecycle

```
User → POST /billing/checkout → Polar Checkout
                                      ↓
                            checkout.updated (succeeded)
                                      ↓
                            customer linked to hosting_account
                                      ↓
                            subscription.created / .active / .updated
                                      ↓
                            plan_code from allowlisted Product ID,
                            period aligned, usage limit synced
```

Unmapped Product IDs never grant Pro/Team. The webhook logs a warning and leaves `plan_code` unchanged.

### Cancellation

When a subscription is revoked or reaches a terminal canceled status:
- `plan_code` reverts to `free`
- `polar_subscription_id` is cleared
- Usage limit drops to the free tier

End-of-period cancellations (`cancel_at_period_end`) keep the paid plan until `subscription.revoked`.

### Payment Failure

- Logged as `polar_payment_failed` audit event on `subscription.past_due`
- Account stays on the current plan during Polar's recovery window
- Terminal revoke/cancel → reverts to free

## Idempotency

Webhook events are claimed in `polar_events` (by `webhook-id` header) before processing. Successful deliveries stay claimed so redeliveries are skipped. If processing throws, the claim row is deleted and the handler returns `500` so Polar can retry.

## Database Changes

- Migration **0007**: hosting account columns (later renamed)
- Migration **0010**: `stripe_events` table + pro/team plan seeds
- Migration **0011**: rename `stripe_*` → `polar_*` columns/table

## Local Development

1. Use `POLAR_SERVER=sandbox`
2. Expose your local server (e.g. ngrok) and register `https://….ngrok-free.app/api/webhooks/polar` in Polar sandbox webhooks
3. Copy the sandbox webhook secret into `POLAR_WEBHOOK_SECRET`
