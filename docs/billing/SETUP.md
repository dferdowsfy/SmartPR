# SmartPR Stripe billing drop-in — setup

Copy these files into the SmartPR frontend repo. Does not clone or modify git history.

## Layout

- stripe-catalog.json — source of truth for test/live IDs
- ENV.stripe.md — env docs
- .env.example.fragment — append to .env.example
- data/billing_schema.sql — workspace_subscriptions
- patches/add-pricing-nav.diff
- frontend/src/lib/billing/catalog.ts
- frontend/src/lib/billing/entitlements.ts
- frontend/src/lib/billing/stripe.ts
- frontend/src/app/pricing/page.tsx
- frontend/src/app/pricing/pricing.module.css
- frontend/src/app/api/billing/checkout/route.ts
- frontend/src/app/api/billing/webhook/route.ts
- frontend/src/app/components/marketing/MarketingLanding.pricing-nav.patch.md

## Steps

1. In frontend/, install the stripe npm package.
2. Merge frontend/src/** into the host frontend/src/**.
3. Apply data/billing_schema.sql against Postgres (workspaces table must exist).
4. Append .env.example.fragment to .env.example and set real values (see ENV.stripe.md).
5. Add Pricing to the marketing header nav (patches/add-pricing-nav.diff).
6. Point Stripe webhooks at POST /api/billing/webhook for:
   checkout.session.completed, customer.subscription.updated, customer.subscription.deleted.
7. Ensure Newsreader (--font-display) and IBM Plex Sans match MarketingLanding.
8. SmartPRLogo path from pricing page: ../../components/brand/SmartPRLogo

## Behaviour

- Free CSA: /?entry=new-business
- Core / Operator / Partner: Stripe Checkout monthly or yearly
- Enterprise: mailto:hello@getsmartpr.com
- Pilot: one_time Checkout via API (not on main card grid)
- Checkout anonymous-OK; supabase server user id attached as client_reference_id when available
- Webhook upserts workspace_subscriptions via getPool from app/graph/db when importable; else log/no-op

## Design tokens

- Background #f4f1ea, text #161616, teal #245c5c / hover #194d4d
- Primary button 8px radius, cream text #f6f3ea
- Cards ~15px radius, border color-mix(in oklab, #161616 13%, transparent)
- Tone: outcomes-first, may-apply language, government = system of record
