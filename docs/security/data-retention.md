# Data retention

Durations below are **not invented**. Where unknown: **Requires verification.**

## Categories (application)

| Data class | Examples | Retention | Notes |
|------------|----------|-----------|-------|
| Account / auth | Supabase Auth users | **Requires verification** (Supabase project settings) | Deletion follows customer/account closure process — **Requires verification.** |
| Workspace business data | businesses, obligations, evidence metadata | Active customer term + **Requires verification** post-termination | Soft-delete patterns vary by table. |
| Evidence files | Supabase Storage buckets | **Requires verification** | Tied to workspace lifecycle. |
| Audit events | `audit_events`, `admin_audit_log` | **Requires verification** (recommend long retention for security investigations) | Append-only; no in-app purge UI. |
| Support access grants | `support_access_grants` | Retain expired/revoked rows for audit | Do not hard-delete without legal review. |
| Billing | Stripe customer/subscription | Per Stripe + **Requires verification** | Stripe is system of record for payments. |
| AI logs | Central `logAiEvent` metadata | **Requires verification** of log sink retention | Abstraction avoids raw confidential content. |

## Safe deletion

Only implement automated deletion where product requirements are explicit. This readiness PR does **not** add mass-delete jobs. Prefer:

1. Document the legal/business trigger.
2. Soft-delete or anonymize where feasible.
3. Audit the deletion event.
4. Record evidence for the control — never backdate.

## Customer requests

DSAR / deletion requests: process **Requires verification** (owner, SLA, tooling).
