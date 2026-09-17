# Security Control Inventory (SOC 2 readiness — not certification)

> **Disclaimer:** This inventory supports SOC 2 *readiness* work. It does **not** assert SOC 2 certification or compliance. Status values reflect repository evidence as of the inventory date below. Items marked **Requires verification** have not been independently confirmed in production infrastructure.

**Inventory date:** 2026-09-17 (ET)  
**Scope:** Application and repository controls observable in `dferdowsfy/SmartPR` (code, SQL, tests, docs). Hosting/vendor SOC reports are out of band unless linked here.

## Status legend

| Status | Meaning |
|--------|---------|
| **Implemented** | Code/schema/tests present and appear enforced server-side |
| **Partial** | Real surface exists; gaps remain (documented) |
| **Documented only** | Policy/runbook present; operational evidence not in repo |
| **Missing** | Not found in repo |
| **Requires verification** | Exists in code or config hints, but prod enforcement / vendor attestation not confirmed here |

---

## 1. Identity & access

| Control | Status | Evidence (repo) | Notes / gaps |
|---------|--------|-----------------|--------------|
| Authentication (Supabase Auth) | Implemented | `frontend/src/middleware.ts`, `lib/supabase/*`, auth routes | Session refresh on requests. Prod IdP config: **Requires verification.** |
| Admin allowlist / superadmin gate | Implemented | `lib/admin.ts`, `api/admin/_util.ts` `requireSuperAdmin` | OPEN DEFAULT when no admins configured — intentional for bootstrapping; lock down in prod (**Requires verification** that `ADMIN_EMAILS` / `admin_allowlist` are populated). |
| Workspace RBAC (legacy + enterprise) | Implemented | `data/rbac_schema.sql`, `data/enterprise_schema.sql` roles/assignments, `lib/enterprise-permissions.ts` | Hierarchical scopes; falls back to `workspace_members`. |
| SSO / domain enforcement | Partial | `api/enterprise/security/*`, `api/sso/lookup`, enterprise security UI | Connection test + enforcement APIs exist. IdP production wiring: **Requires verification.** |
| SCIM provisioning | Implemented | `api/scim/v2/**`, bearer via `service_accounts` + `scim` scope | Constant-time hash compare; revoked/expired rejected. |
| MFA policy knobs | Partial | Enterprise security posture `mfa_policy`; MFA email templates under `data/email-templates/` | App stores policy; actual MFA enrollment is Supabase/Auth-side — **Requires verification.** |
| Support access (time-boxed) | Implemented | `support_access_grants`, grant/revoke APIs, `getActiveSupportGrant`, `requireOrgAccess` | Reason + duration required; RO default; expiry checked in SQL (`expires_at > now()`). Use/expiry audit events hardened in this readiness PR. |
| Service accounts | Implemented | `service_accounts` table + integrations APIs; hash-only store; show-once credential | Rotate/revoke, scopes, fingerprint, `last_used_at`, timing-safe compare. |

## 2. Tenant isolation

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Workspace scoping in APIs | Implemented | Enterprise `_util`, permission gates, workspace query params | Do not weaken. |
| RLS / tenant isolation SQL | Partial | `data/enterprise_phase5_tenant_isolation.sql`, compliance workspace RLS notes | Full RLS coverage across all tables: **Requires verification** against live DB. |
| Support access ≠ membership | Implemented | `getActiveSupportGrant` docs + `requireOrgAccess` | Grants never create membership. |

## 3. Audit & logging

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Append-only `audit_events` | Implemented | `enterprise_schema.sql` + `enterprise_audit_no_modify` trigger | UPDATE/DELETE blocked at DB. |
| Legacy `admin_audit_log` | Implemented | `api/admin/_util.ts` `auditLog` | Parallel to enterprise audit for superadmin actions. |
| Secret redaction in audit payloads | Implemented | `writeAuditEvent` + `redactSecrets` | Deep strip of secret-like keys. |
| Security event taxonomy | Partial | Normalized in this PR (`lib/security/events.ts`); existing action strings preserved for compat | Migration of all historical strings: incremental. |

## 4. Secrets & cryptography

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Service-role / webhook keys server-only | Implemented | Comments + server modules; `.env.example` | Never return service role in client responses — guardrail + tests in this PR. |
| Webhook secret encryption at rest | Implemented | AES-256-GCM via `ENTERPRISE_WEBHOOK_ENC_KEY` | Fail-closed if key missing. |
| CI secret scan | Partial | Workflow added in this PR (gitleaks/patterns) | Historical secret rotation: **Requires verification.** |

## 5. Change management / CI

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| GitHub Actions CI | Partial / Missing historically | `docs/security/examples/github-actions-ci.yml (copy to .github/workflows/)` added in this PR | Branch protection: see `github-branch-protection-required.md` — **Requires verification** on GitHub settings. |
| Deploy / change log | Documented only | `docs/security/change-deploy-log.md` | Operational process; no fabricated entries. |

## 6. Availability, backup, vulnerability, incidents

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Hosting (Railway) | Requires verification | README / worker docs reference Railway | Uptime SLO, WAF, backups: **Requires verification.** |
| Database backups (Supabase) | Requires verification | Supabase project used | Retention/RPO/RTO: see `backup-recovery.md`. |
| Vulnerability management | Documented only | `vulnerability-management.md` + evidence hooks | No fake scan results. |
| Incident response | Documented + module | `incident-response-plan.md` + `security_incidents` schema/API | Empty until real incidents recorded. |

## 7. Data governance

| Control | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Data retention | Documented only | `data-retention.md` | Durations marked **Requires verification** — none invented. |
| AI data governance | Documented + logging abstraction | `ai-data-governance.md`, `lib/security/ai-logging.ts` | xAI / browser-use paths; no raw confidential logging in abstraction. |
| Subprocessors | Documented | `subprocessors.md` | Based on code/env references only. |

## 8. SOC 2 readiness artifacts (this PR)

| Artifact | Path |
|----------|------|
| Control registry | `data/security_controls.json`, `frontend/src/lib/security/` |
| Evidence / risks / incidents / policies schema | `data/security_soc2_readiness.sql` |
| Admin security center | `/admin/security`, access-review, APIs under `/api/admin/security/**` |
| Readiness overview | `docs/security/soc2-readiness.md` |
| Client-facing overview | `docs/security/client-security-overview.md` |

## Honest gaps (highest priority)

1. Confirm production admin allowlist is non-empty (close OPEN DEFAULT).
2. Confirm GitHub branch protection + required checks (doc lists required settings).
3. Confirm Supabase backup retention and RLS applied in production.
4. Obtain vendor SOC 2 / security reports (Supabase, Stripe, Railway, xAI) — not stored as claims in-app.
5. Operationalize access reviews on a calendar; use `/admin/security/access-review` for evidence, not as a substitute for human review.
