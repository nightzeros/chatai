# Stripe Billing Integration

ChatAI supports paid subscription plans via Stripe. This guide covers setup, configuration, and the subscription lifecycle.

## Prerequisites

- A [Stripe account](https://dashboard.stripe.com/register) (test mode works for development)
- Products and Prices configured in Stripe Dashboard

## Environment Variables

Add these to your `.env`:

```bash
# Stripe secret key (sk_live_… or sk_test_…)
STRIPE_SECRET_KEY=sk_test_...

# Webhook signing secret (whsec_…) — from Stripe Dashboard → Webhooks
STRIPE_WEBHOOK_SECRET=whsec_...

# Publishable key (optional, for client-side Checkout redirect)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Allowlisted Price IDs. Checkout rejects any other price.
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_TEAM=price_...
```

When `STRIPE_SECRET_KEY` is not set, all billing endpoints return `503` and the system operates in free-tier-only mode. Checkout also returns `503` until at least one of `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_TEAM` is set.

## Stripe Product Setup

### 1. Create Products in Stripe Dashboard

Create a Product for each plan tier. Copy each Price ID into the matching env var above. Optionally set **metadata** on the Price for documentation:

| Metadata key | Value | Description |
|---|---|---|
| `plan_code` | `pro` or `team` | Informational. Entitlements come from the Price ID allowlist, not metadata. |

### 2. Plan Tiers (seeded in migration 0010)

| Plan | Monthly Limit | Request Cap | Features |
|---|---|---|---|
| `free` | $5.00 | — | — |
| `pro` | $25.00 | — | evals, 20 assistants |
| `team` | $100.00 | — | evals, 100 assistants, team members |

### 3. Webhook Endpoint

In Stripe Dashboard → Developers → Webhooks, add an endpoint:

- **URL:** `https://your-domain.com/api/webhooks/stripe`
- **Events to listen for:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.

## API Endpoints

### `GET /api/v1/account/billing`

Returns current billing status (session auth required).

```json
{
  "planCode": "pro",
  "effectiveLimitMicros": 25000000,
  "stripeConfigured": true,
  "hasSubscription": true,
  "subscription": {
    "id": "sub_…",
    "status": "active",
    "billingCycleAnchor": 1693526400,
    "cancelAtPeriodEnd": false,
    "cancelAt": null
  }
}
```

### `POST /api/v1/account/billing/checkout`

Creates a Stripe Checkout Session for upgrading.

```json
{ "priceId": "price_…" }
```

`priceId` must match `STRIPE_PRICE_ID_PRO` or `STRIPE_PRICE_ID_TEAM`. Optional `successUrl` / `cancelUrl` must be same-origin (or a relative path). Defaults: `/dashboard/usage`.

Returns `{ "url": "https://checkout.stripe.com/…" }`.

### `POST /api/v1/account/billing/portal`

Creates a Stripe Customer Portal session for managing the subscription.

```json
{ "returnUrl": "/dashboard/usage" }
```

`returnUrl` must be same-origin. Returns `{ "url": "https://billing.stripe.com/…" }`.

## Subscription Lifecycle

```
User → POST /billing/checkout → Stripe Checkout
                                      ↓
                            checkout.session.completed webhook
                                      ↓
                            customer linked to hosting_account
                                      ↓
                            customer.subscription.created webhook
                                      ↓
                            plan_code updated from allowlisted Price ID,
                            period aligned, usage_period_balances.limit_micros synced
```

Unmapped Price IDs never grant Pro/Team. The webhook logs a warning and leaves `plan_code` unchanged.

### Cancellation

When a subscription is canceled or expires:
- `plan_code` reverts to `free`
- `stripe_subscription_id` is cleared
- Usage limit drops to the free tier

### Payment Failure

- Logged as `stripe_payment_failed` audit event
- Account stays active during Stripe's dunning retry period
- If Stripe gives up → `subscription.deleted` → reverts to free

## Idempotency

Webhook events are claimed in `stripe_events` before processing. Successful deliveries stay claimed so Stripe redeliveries are skipped. If processing throws, the claim row is deleted and the handler returns `500` so Stripe can retry.

## Database Changes (Migration 0010)

- `stripe_events` table for webhook deduplication
- `plan_entitlements` seeded with `pro` ($25/mo) and `team` ($100/mo) plans

The `hosting_accounts` table already has `stripe_customer_id` and `stripe_subscription_id` columns (added in migration 0007).

## Local Development

Use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The CLI will output a webhook signing secret to use as `STRIPE_WEBHOOK_SECRET`.
