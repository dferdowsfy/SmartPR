# Stripe environment variables (SmartPR)

Use **test** keys and price IDs locally; switch to **live** in production.

## Required

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## Price IDs (optional — catalog falls back to test defaults)

```bash
STRIPE_PRICE_FREE_MONTHLY=price_1UD5AgHS9D3i7NQZhu1XOOhl
STRIPE_PRICE_CORE_MONTHLY=price_1UD5AlHS9D3i7NQZWOYhVoY2
STRIPE_PRICE_CORE_YEARLY=price_1UD5AlHS9D3i7NQZNzSyMOmn
STRIPE_PRICE_OPERATOR_MONTHLY=price_1UD5AlHS9D3i7NQZiAjF4hvs
STRIPE_PRICE_OPERATOR_YEARLY=price_1UD5AlHS9D3i7NQZPp2dMG2u
STRIPE_PRICE_PARTNER_MONTHLY=price_1UD5AlHS9D3i7NQZwMoJMJtV
STRIPE_PRICE_PARTNER_YEARLY=price_1UD5AmHS9D3i7NQZAi0q065Y
STRIPE_PRICE_PILOT_ONE_TIME=price_1UD5AmHS9D3i7NQZhqshuOXp
```

Optional product overrides:

```bash
STRIPE_PRODUCT_FREE=prod_VDWC8bFq8sA8Ox
STRIPE_PRODUCT_CORE=prod_VDWCVPbVA2u4FC
STRIPE_PRODUCT_OPERATOR=prod_VDWCDgMcvMJobv
STRIPE_PRODUCT_PARTNER=prod_VDWCzFKJkIpFc0
STRIPE_PRODUCT_PILOT=prod_VDWChPZiQSoPbq
STRIPE_PRODUCT_ENTERPRISE=prod_VDWCBYm1uH2voo
```

## How a plan finds its price

`getPriceId(plan, period)` uses `STRIPE_PRICE_<PLAN>_<PERIOD>` when set. Otherwise it uses the
catalog ID for the key's mode: `sk_live_`/`rk_live_` keys get `plans.*.live` from
`stripe-catalog.json`, and any other key gets `plans.*.test`. Before opening Checkout, the
server retrieves the price and refuses it (503, logged as `price mismatch`) if it's archived, its
product is archived, or its currency, amount or interval doesn't match the plan card.

Check every plan against your key (read-only):

```bash
STRIPE_SECRET_KEY=sk_live_... npm run billing:verify
```

Signed-out visitors who click Continue go to `/auth/login?next=/pricing?checkout=<plan>&period=…`
and resume checkout after signing in.

## Live vs test

| Mode | Secret key prefix | Price source |
|------|-------------------|--------------|
| Test | `sk_test_` | Defaults in `catalog.ts` / `stripe-catalog.json` → `plans.*.test` |
| Live | `sk_live_` | Set `STRIPE_PRICE_*` from `stripe-catalog.json` → `plans.*.live` |

Enterprise has a product only (no Checkout price) — contact sales.

## Webhook

Point Stripe CLI or Dashboard to:

`POST /api/billing/webhook`

Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

## `.env.example` fragment

Append the block in `.env.example.fragment` (same folder) to your app `.env.example`.
