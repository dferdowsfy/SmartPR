# Subprocessors (repository-evident)

List derived from code, README, and `.env.example` references. Not a legal schedule; contract exhibits **Require verification**.

| Subprocessor | Purpose | Data typically involved | Repo evidence |
|--------------|---------|-------------------------|---------------|
| Supabase | Auth, PostgreSQL, Storage | Account, workspace, evidence files | `NEXT_PUBLIC_SUPABASE_*`, schemas, middleware |
| Stripe | Billing / subscriptions | Customer email, plan, payment tokens (Stripe-hosted) | `lib/billing/*`, Stripe env vars |
| xAI | AI completions | Prompt fragments derived from user/business context | `XAI_API_KEY`, README |
| Railway | App / worker hosting | Application runtime, logs, env secrets at rest on host | README, workers README |
| Google (Gmail SMTP) | Founder/lead notification email | Lead/notification content to operator inbox | `GMAIL_SMTP_*` in `lib/leads.ts` |
| Browser Use (optional cloud) | Browser automation for agency runs | Session telemetry; page content as configured | `workers/browser-agent`, agency-run provider flags |

## Notes

- SmartPR does not claim these vendors are “SOC 2 certified” in-product. Request their reports under NDA when needed — **Requires verification** per vendor.
- Adding a new subprocessor should update this file and customer notices as appropriate.
