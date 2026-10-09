# Database TLS policy

The Postgres pool (`frontend/src/app/graph/db.ts`) takes its TLS settings from
`resolveDbTls()` in `frontend/src/app/graph/dbTls.ts`. Tests:
`frontend/src/app/graph/dbTls.test.ts` (part of `npm run test:security`).

## Enterprise (`DEPLOYMENT_MODE=enterprise`, or an invalid deployment config)

| Setting | Behaviour |
|---|---|
| Default | Encrypted and the server certificate is verified against the system trust store. |
| `PGSSL_CA` / `PGSSL_CA_FILE` | Verified against that CA bundle. |
| `PGSSL_DISABLE` | Refused at startup. TLS is mandatory. |
| `sslmode=disable / allow / prefer / no-verify` in the URL | Refused at startup. |
| Any other `ssl*` URL parameter | Stripped, so the policy above is authoritative. |

`pg` lets `ssl*` query parameters in the connection string replace the `ssl`
object entirely, which would silently drop a pinned CA. That is why the policy
strips them whenever it verifies.

## Standard (default, unchanged unless configured)

| Setting | Behaviour |
|---|---|
| Nothing set | Encrypted but **not verified** (previous behaviour). A warning is logged once. |
| `PGSSL_CA` / `PGSSL_CA_FILE` | Verified against that CA bundle. |
| `PGSSL_VERIFY=true` | Verified against the system trust store. |
| `PGSSL_DISABLE=1` | No TLS (local development only). |

## Closing the Standard gap in production

1. Download the database provider's CA certificate (Supabase: Project Settings → Database → SSL configuration).
2. Make it available to the app and set `PGSSL_CA_FILE` (or paste the PEM into `PGSSL_CA`, with `\n` for newlines).
3. Deploy and confirm the `[db] ... NOT verified` warning no longer appears in the logs.
