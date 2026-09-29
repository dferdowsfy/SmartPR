# SmartPR Enterprise — Current-State Audit

Status: audit of repository state at commit `a59f5b7` (2026-09-29). Read-only
findings; no runtime behaviour was changed to produce this report. Items that
cannot be proven from the repository (production database role, which SQL files
are applied in production) are marked **UNVERIFIED**.

Governing brief: *SmartPR Enterprise — Customer-Controlled Azure Deployment*.

---

## 0. Architectural principles (approved)

These apply to every enterprise PR and override convenience.

1. **One SmartPR codebase.** No McConnell (or any customer) fork.
2. **Standard is unchanged** unless explicitly modified in a later reviewed PR.
3. **Enterprise infrastructure is selected through deployment configuration and
   adapters** (`src/lib/config/deployment.ts` and provider interfaces), not
   scattered conditionals.
4. **Customer confidential data remains in the customer's enterprise
   environment.**
5. **SmartPR application state lives in SmartPR-controlled database/storage
   layers.** Model inference is stateless unless an explicitly approved feature
   requires otherwise.
6. **Enterprise AI providers fail closed** to an approved model/deployment
   allowlist.
7. **Browser Use Cloud and xAI voice telephony are disabled by default in
   Enterprise** until explicitly approved.
8. **Azure-specific code does not leak into business logic** where an
   adapter/provider interface can be used.

## 0.1 Approved decision: clean enterprise database

SmartPR Enterprise provisions a **clean Azure Database for PostgreSQL** from
**versioned SmartPR migrations** plus **approved reference/regulatory seed
data**. It does **not** copy unrelated Standard/Supabase customer data into the
enterprise database. Any migration of a specific customer's own pilot data is a
separate, explicitly approved Phase 12 activity.

---

## A. Current-state architecture

| Layer | Finding |
|---|---|
| App | Next.js 16.2.9 / React 19 (`frontend/`), 194 route handlers, `runtime = "nodejs"`. `src/middleware.ts` refreshes Supabase sessions and gates `/dashboard`, `/businesses`, `/calendar`, `/history`, `/settings`. |
| Legacy backend | `backend/main.py` (FastAPI, Procfile) — direct xAI calls. Appears secondary. |
| Browser worker | `workers/browser-agent/` (Python, Docker, `browser_use` + LangChain `ChatOpenAI` pointed at `https://api.x.ai/v1`). |
| Hosting | Railway (code comments, `docs/security/subprocessors.md`, canonical-host redirect). No IaC; no `.github/` CI in repo. |
| Background jobs | `/api/cron/*` (compliance-digest, compliance-reminders, regulatory-scan, voice-auto-recap), shared-secret protected; external scheduler. |
| Data access | `pg` Pool in `src/app/graph/db.ts` (`DATABASE_URL`/`DIRECT_URL`), imported by ~183 files. `supabase-js` in only 7 files (auth, Storage, billing). |
| Tenant model | `workspaces` → `workspace_members` → `role_assignments` (`lib/enterprise-permissions.ts`); data scoped by `businesses.workspace_id`. |
| Cache/session | Supabase auth cookies; in-memory per-process rate limiting (`lib/rateLimit.ts`); voice session tokens in Postgres; no Redis. |

## B. Supabase dependency inventory

### Database (largely portable Postgres)

- 25 files `data/*.sql` (~3.7k lines) + `design/db/smartpr-database-schema.sql`; ~100 tables.
- Extensions: `pgcrypto`, `uuid-ossp` only. **No pgvector, no embeddings.**
- Runtime DDL: 46 `CREATE TABLE IF NOT EXISTS` statements executed from
  TypeScript via `ensureSchema()` (`graph/store.ts`, `requirements/schema.ts`,
  `compliance/schema.ts`, `rk/schema.ts`, several routes). No migration runner
  or version table → two schema sources, app role needs DDL.

Supabase-specific:

| Dependency | Location |
|---|---|
| `auth.uid()` (11) | RLS helper `enterprise_is_member()`, storage policies |
| `authenticated` (51) / `anon` (1) roles | policies in `enterprise_schema.sql` (28), `enterprise_phase2_additions.sql` (16), `compliance_workspace_schema.sql` (3), `enterprise_phase8.sql` (1) |
| `auth.users` joins | ~15 routes under `api/admin/*`, `api/enterprise/admin/*` |
| Direct `INSERT INTO auth.users` / `auth.identities` | `api/admin/billing/route.ts` |
| `auth.sso_providers` | `api/enterprise/security/test-sso` |
| `storage.buckets` / `storage.objects` + policies | `compliance_workspace_schema.sql` |
| 4 `SECURITY DEFINER` functions | enterprise schema, admin tools |

### Auth

Supabase Auth: password, sign-up, OTP, password reset, PKCE code exchange,
`signInWithSSO` (SAML). `getCurrentUser()` (`lib/supabase/server.ts`, 82 callers)
is the single identity entry point; `bootstrapPlatformUser(User)` takes the
Supabase `User` type. SCIM 2.0 exists (`api/scim/v2`) and maps to Supabase users
by email. `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` ship to the browser.

### Storage

Buckets: `evidence`, deliverables, generated filings, templates. User-session
client in `api/evidence/*` and `api/businesses/[id]/evidence-package`;
`forms/artifacts/storage.ts` already defines `StorageCapableClient`;
service-role key used in `lib/voice/deliverables.ts` and
`scripts/sync-template-library.ts`. Evidence paths keyed by `${user.id}/…`.

## C. AI provider dependency map

| Use | Provider / endpoint | Model | Mechanism | Notes |
|---|---|---|---|---|
| Document analysis `api/analyze-document` | xAI `/v1/responses` | `XAI_MODEL` (default `grok-4.3`) | `fetch`, `app/ai/xai.ts` | 60 s timeout, regex JSON parse, document text sent, `store:false` |
| Intake interpret `api/intake/interpret` | same | same | same | 30 s, regex JSON |
| Chat `api/chat` | same | same | same | 25 s |
| Passport voice `api/passport/voice` | xAI `/v1/stt` + `/responses` | same | same | audio + extraction |
| Intake voice `api/intake/voice` | xAI `/v1/stt` | — | same | audio |
| Regulatory ingest `rk/ingest.ts` | xAI `/responses` | same | same | admin; output persisted to `rk_regulatory_sources` |
| Phone voice agent | xAI realtime WSS + `/v1/realtime/calls` | xAI console agent (`XAI_AGENT_ID`) | `ws`, `lib/voice/xaiCallManager.ts` | xAI calls back to SmartPR MCP (`/api/mcp/voice`, 19 tools); agent config held by xAI |
| Browser agent (cloud) | Browser Use Cloud v4 | default `gpt-5.6-luna` | `browser-use-sdk` | page/form data to Browser Use; live iframe |
| Browser agent (self-hosted) | worker → xAI | `grok-4.3` | LangChain | `WORKER_API_TOKEN` |
| Legacy backend | xAI `/responses` | `grok-4.3` | `httpx` | |

No embeddings, no client streaming, no OpenAI/Anthropic direct calls. Tool
calling only via voice MCP. `lib/security/ai-logging.ts` (metadata-only) exists
but is not wired on every path. Single chokepoint for text/STT: `app/ai/xai.ts`
(6 importers).

## D. Security architecture

### Secrets

- High value: `DATABASE_URL`/`DIRECT_URL` (role **UNVERIFIED**, likely owner),
  `SUPABASE_SERVICE_ROLE_KEY`, `XAI_API_KEY`, `STRIPE_SECRET_KEY`,
  `ENTERPRISE_WEBHOOK_ENC_KEY`, `VOICE_PIN_PEPPER`.
- Shared bearer secrets: `WORKER_API_TOKEN`, `VOICE_GATEWAY_API_KEY`,
  `XAI_CONSOLE_MCP_KEY`, `XAI_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`,
  `*_CRON_SECRET` (4), `COMPLIANCE_UNSUBSCRIBE_SECRET`.
- Third-party: `GMAIL_SMTP_APP_PASSWORD`, `RESEND_API_KEY`, `BROWSER_USE_API_KEY`,
  `QA_GOOGLE_CLIENT_SECRET`, `QA_GMAIL_REFRESH_TOKEN`.
- DB TLS: `ssl: { rejectUnauthorized: false }` (`graph/db.ts`).

### Egress / subprocessors

Supabase (all data); xAI (documents, intake text, audio, calls); Browser Use
Cloud (filing data); Stripe (billing email); Gmail SMTP / Resend (notification
content); Google Analytics (browser telemetry); PR government portals (filing
data via agents); Railway (runtime, logs).

### Tenant isolation

Enforced in **application SQL** (e.g. joins on `workspace_members … user_id = $2`,
`requireEnterprisePermission` in ~21 API files). If the pool role bypasses RLS
(**UNVERIFIED**), RLS only protects supabase-js browser/Storage traffic. Prior
real gap: `regulatory_impacts` (fixed in `enterprise_phase5_tenant_isolation.sql`).

### Admin

`lib/admin.ts` **open default**: with `ADMIN_EMAILS` and `admin_allowlist` both
empty, every signed-in user is an admin. A fresh database starts in that state.

### Audit

Tables `audit_events`, `admin_audit_log`, `voice_audit_log`, `rk_audit_events`.
Logging sink: `console.log` only.

## E. Enterprise blockers

### MUST CHANGE

1. Auth hard-wired to Supabase (`getCurrentUser`, middleware, browser client, bootstrap, SAML, SCIM matching).
2. `auth.users` joins (~15 routes) and direct writes to `auth.users`/`auth.identities`.
3. RLS depends on `auth.uid()` / `authenticated`.
4. Storage hard-wired to Supabase (6 call sites + service-role client).
5. Direct vendor model calls; no policy/allowlist, no Azure endpoint, no request tagging.
6. xAI voice telephony: vendor-held agent config, requires public MCP callback.
7. Browser Use Cloud sends client data to a third party.
8. Runtime DDL via `ensureSchema()`; no migration runner.
9. Admin open default.
10. DB TLS verification disabled; no Entra/managed-identity DB auth.
11. No IaC; no CI/CD.

### SHOULD CHANGE

In-memory rate limiting; two email providers incl. Gmail app password; GA in
customer tenant; AI logging coverage; legacy FastAPI backend; regex JSON
extraction; shared-secret cron; console-only logging; Stripe in enterprise.

### ACCEPTABLE AS-IS

`pg` data layer; extension set; no vector store; rules engine / KB as code;
workspace/role/RBAC model incl. SCIM group mappings; `store:false`; metadata-only
AI logger; existing audit tables.

## F. Database provisioning strategy (approved direction)

1. Consolidate `data/*.sql` + runtime `ensureSchema` DDL into ordered, versioned
   migrations with a `schema_migrations` table; verify parity against a
   **schema-only** dump of Standard (no data). `ensureSchema()` retained for
   Standard, skipped in enterprise.
2. Split Supabase-only DDL (`auth.*`, `storage.*`, `authenticated`/`anon`
   policies) into a Supabase overlay; Azure gets equivalent session-variable RLS
   as defense in depth.
3. Seed **reference/regulatory data only** (requirements seed, RK publications,
   form template library) — idempotent and checksummed. No workspaces,
   businesses, users, evidence, audit or voice data.
4. Roles: `smartpr_migrator` (DDL, CI only), `smartpr_app` (DML, Entra token via
   managed identity), `smartpr_readonly`. TLS `verify-full`.
5. Validation: schema/index/constraint parity, seed checksums, zero customer
   rows, cross-workspace isolation tests.
6. Explicit first-admin bootstrap (Entra group → `org_owner`, allowlist via IaC);
   never the open default.

## G. Required abstractions

| Module | Purpose | Existing seam |
|---|---|---|
| `lib/config/deployment.ts` (+ database/storage/auth/models) | Typed validated deployment config | added in PR #1, not yet imported |
| DB pool factory | Supabase vs Azure (Entra token, strict TLS) | `graph/db.ts` `getPool()` |
| Identity provider + `app_users` | Decouple from Supabase `User`; Entra OIDC | `lib/supabase/server.ts`, `lib/auth/bootstrap.ts` |
| `FileStorage` | Supabase + Azure Blob adapters | `forms/artifacts/storage.ts` |
| `lib/ai` router/policy/providers | Use-case routing, fail-closed allowlist, tagging | `app/ai/xai.ts` |
| Feature gates | voice telephony, Browser Use Cloud, Stripe, GA, email | entitlements/flags |
| Rate limiter | distributed | `lib/rateLimit.ts` |
| Migrations + runner | single schema source | `data/*.sql`, `ensureSchema()` |

## H. Risks and unknowns

- Production DB role (RLS bypass) — **UNVERIFIED**.
- Schema drift between SQL files, runtime DDL, and production — **UNVERIFIED**.
- Direct `auth.users` writes fragile even for Standard.
- Foundry model parity / Grok availability in approved regions; golden tests must pass per deployment.
- `store:false` is a request flag, not a verified retention guarantee.
- Voice/browser agents may have no approved enterprise path.
- No CI gating refactors of shared chokepoints.
- Baseline at audit time: `npm run lint` fails (168 errors / 63 warnings, pre-existing); `test:regulatory-correctness` has 3 pre-existing golden failures (G13, G20, G21).

## I. PR sequence

1. Typed deployment config + docs (no runtime change).
2. CI workflow.
3. Fail-closed admin (enterprise).
4. AI router/policy + xAI adapter.
5. Azure Foundry adapter + per-deployment golden tests.
6. Versioned migrations + runner; Supabase overlay; parity script.
7. `app_users`; remove `auth.users` joins; identity interface (Supabase adapter).
8. Entra OIDC adapter.
9. `FileStorage` + Azure Blob.
10. Azure DB pool auth + strict TLS.
11. Enterprise feature gates; distributed rate limiter.
12. IaC.
13. Cross-tenant isolation + security acceptance tests.
14. Enterprise staging + remaining docs.
