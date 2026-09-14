# Partner codes (design-partner pilots)

Shared workspace + plan for pilots (e.g. Luyo). Users redeem one code and land on the **same** workspace under the configured plan (default `partner`), not separate Free accounts.

## Apply schema (production Postgres)

```bash
psql "$DATABASE_URL" -f data/partner_codes_schema.sql
```

Or paste `data/partner_codes_schema.sql` into the Supabase SQL Editor. Safe to re-run. Seeds **`LUYO-90`** (plan `partner`, max 10 redemptions, 90-day pilot).

## Create more codes

**SQL:**

```sql
SELECT admin_create_partner_code('ACME-90', 'partner', 10, 90, 'Acme Pilot');
-- args: code, plan, max_redemptions, pilot_days, workspace_name [, expires_days, notes]
```

**Admin API** (signed-in platform admin):

- `GET /api/admin/partner-codes` — list
- `POST /api/admin/partner-codes` — `{ "code":"ACME-90", "plan":"partner", "maxRedemptions":10, "pilotDays":90, "workspaceName":"Acme Pilot" }`

## Redeem

- Signup: optional “Have a partner code?” or `/signup?code=LUYO-90` (prefill). Stored in `user_metadata.partner_code` and sent to bootstrap.
- `POST /api/partner-codes/redeem` `{ "code":"LUYO-90" }` (auth required)
- `POST /api/auth/bootstrap` `{ "partnerCode":"LUYO-90" }`

First redeemer creates the pilot workspace (OWNER) and sets `workspace_subscriptions` to the code’s plan. Later redeemers join as MEMBER on that workspace.

Bad / expired / exhausted codes return `400` with `{ error, code: "invalid"|"expired"|"inactive"|"exhausted" }`.

## Note on `?code=`

- `/signup?code=LUYO-90` — partner code prefill
- `/auth/callback?code=…` — Supabase OAuth / PKCE (unchanged)
