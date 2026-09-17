# Grok phone voice agent — Phase 1 API contract

This document describes the contract the Grok realtime voice agent uses to serve
authenticated SmartPR callers. It is documentation only: **no Grok agent
configuration was changed in Phase 1.** The agent integration (Twilio/xAI
realtime wiring) is future work; this contract pins what it may call and how.

> **Phase 2:** the same capabilities are now also exposed as a production
> Remote MCP server for xAI Speech-to-Speech — see `docs/voice-mcp.md`.
> The MCP server is an adapter over the Phase 1 services documented here;
> this contract is unchanged.

## Architectural rule (non-negotiable)

> Grok must never provide or choose `userId`, `workspaceId`, account role,
> subscription plan, email recipient, or authorization level.

Every account request follows the pipeline:

```
voice session token → validate session → derive user → derive workspace
membership → verify resource access → check plan entitlement where applicable
→ perform SmartPR operation → audit → return safe result
```

Grok supplies only: the session token (from PIN verification) and, where a
tool needs it, a business id the caller named. Everything identity-related is
server-derived from the session.

## Authentication flow (server-to-server)

The telephony gateway (not Grok) performs these calls with a shared secret.

Base: `/api/voice` · Auth: `Authorization: Bearer <VOICE_GATEWAY_API_KEY>`
(timing-safe comparison; missing/misconfigured secret fails closed).

1. `POST /api/voice/phone/lookup` `{ phone }` → `{ enrolled, enabled }`
   (does not reveal whether a number exists beyond the boolean; failures audited)
2. `POST /api/voice/phone/verify-pin` `{ phone, pin }` →
   `{ ok: true, session_token: "vs_…", expires_at }`
   - 5 wrong PINs → 15-minute lockout (atomic counter, row-locked)
   - Success resets failures, supersedes prior active sessions, issues a
     30-minute opaque 256-bit token (only SHA-256 stored server-side)
3. `POST /api/voice/session/validate` `{ session_token }` → `{ valid, expires_at }`
4. `POST /api/voice/session/revoke` `{ session_token }` → `{ revoked: true }`
   (call hangup / user disable)

Phone numbers normalize to E.164 (10-digit input defaults to NANP `+1`).
PINs are exactly 6 digits, stored as scrypt hashes (N=16384, r=8, p=1, random
16-byte salt) — never plaintext. One phone per user; enrollment/change/disable
live in **Settings → Phone access** and require an authenticated web session.

## Phase 1 voice tools

Grok calls these with `Authorization: Bearer <session_token>` (the `vs_…`
token from step 2). All nine derive the user, workspace, role, and plan from
the session server-side.

| Tool | Method / path | Notes |
|---|---|---|
| `get_account_context` | `GET /api/voice/v1/context` | Caller identity: name, verified email, workspace, role, plan. No `user_id` is exposed. |
| `list_my_businesses` | `GET /api/voice/v1/businesses` | Businesses the session user may access. |
| `get_business_summary` | `GET /api/voice/v1/businesses/{id}/summary` | Profile facts + compliance snapshot. |
| `get_requirements` | `GET /api/voice/v1/businesses/{id}/requirements` | Persisted obligations from the deterministic requirements engine. Grok never calculates requirements. |
| `get_missing_items` | `GET /api/voice/v1/businesses/{id}/missing-items` | Missing evidence / incomplete items. |
| `get_readiness` | `GET /api/voice/v1/businesses/{id}/readiness` | Readiness / completeness score. |
| `get_deadlines` | `GET /api/voice/v1/businesses/{id}/deadlines` | Upcoming compliance deadlines (excludes unknown/estimated dates). |
| `get_evidence_status` | `GET /api/voice/v1/businesses/{id}/evidence` | Evidence locker status per business. |
| `email_my_summary` | `POST /api/voice/v1/email-summary` | Sends the caller's SmartPR summary to the **verified authenticated user's email on file**. Any `email`/`to`/`recipient` field in the request body is ignored. Available to free users; does not change paid-plan rules for recurring compliance reminders. |

Cross-user / cross-workspace business access is denied and audited. Plan
entitlements are enforced with the existing billing helpers — no parallel
billing logic.

## Explicitly out of scope (Phase 1)

Government submissions, payments, legal signatures, evidence deletion, billing
changes, invitations, workspace administration, arbitrary account updates,
high-risk writes, and unrestricted database access. Grok receives read results
and the one fixed-recipient email — nothing else.

## Audit & usage

Every voice operation writes to `voice_audit_log` (auth events, session
lifecycle, tool calls, denials, lockouts) and `voice_usage` (daily call, tool,
and email counters). Schema: `data/voice_phone_access_schema.sql`.

## Future wiring (not built)

When the telephony layer is added, it must: call `lookup` on caller ID,
prompt for the 6-digit PIN, call `verify-pin`, pass the `session_token` to
Grok as the tool-call credential, and call `revoke` on hangup. Grok's tool
definitions must mirror the nine tools above exactly — no extra parameters,
especially no identity, role, plan, or recipient fields.
