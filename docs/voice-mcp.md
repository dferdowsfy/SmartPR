# SmartPR Remote MCP Server — Phases 2–3

Production adapter exposing the Phase 1 authenticated voice capabilities to
xAI Speech-to-Speech as Remote MCP tools.

**Status: implemented, tested, NOT yet deployed or production-verified.**
The Phase 2 schema migration (`data/voice_phase2_schema.sql`) has not been
applied to Supabase, and no xAI agent configuration has been changed.

Companion doc: `docs/voice-grok-contract.md` (Phase 1 gateway contract).

---

## 1. Architecture

```
Caller → xAI Grok Voice → SmartPR Remote MCP Server → Phase 1 voice session
validation → SmartPR RBAC → SmartPR plan entitlements → existing SmartPR
services → structured result → Grok speaks result
```

The MCP server is a thin adapter. It creates **nothing** new:

- No second authentication system — every `tools/call` validates the Phase 1
  voice session token (`resolveVoiceContext`).
- No second RBAC — `requireBusinessAccess` / `listAccessibleBusinesses`.
- No second entitlement system — `entitlementsFor` / `getWorkspacePlanState`.
- No second requirements engine — `getBusinessObligations` (persisted,
  deterministic obligations).
- No raw database access for Grok — only the 9 curated tools below.

The 9 tool implementations live in `frontend/src/lib/voice/tools.ts` and are
shared verbatim with the Phase 1 REST voice API (`/api/voice/v1/*`). The MCP
handlers in `frontend/src/lib/voice/mcp.ts` contain no business logic — they
authenticate, sanitize arguments, dispatch, map errors, and log observability.

## 2. Endpoint and transport

- **URL:** `POST https://<smartpr-host>/api/mcp/voice`
- **Transport:** Streamable HTTP (JSON-RPC 2.0 over POST). Stateless — no MCP
  session ids, single JSON responses. `GET`/`DELETE` return 405.
- **Protocol versions:** `2025-06-18`, `2025-03-26`, `2024-11-05`
  (server negotiates; falls back to latest).
- **Methods:** `initialize`, `notifications/initialized`, `ping`,
  `tools/list`, `tools/call`.

`initialize` and `tools/list` require no auth and expose no account data.
`tools/call` requires the voice session token (see §3).

## 3. Authentication

Every account-specific request carries the Phase 1 voice session token in the
HTTP `Authorization` header. xAI's Remote MCP docs say the configured
`authorization` value "will be set in the Authorization header" without
naming a scheme, so the server accepts **both** `Bearer <token>` and the raw
token.

The server then:

1. Validates the token (unknown → denied)
2. Rejects expired sessions (30-minute TTL) and revoked sessions
3. Derives user id, workspace, role, plan, and verified email server-side
4. Verifies resource access per call (`requireBusinessAccess`)
5. Checks plan entitlements per call
6. Audits the tool call (`voice_audit_log`) and increments usage
7. Writes one `voice_tool_calls` observability row (§9)
8. Returns only authorized results

Grok never provides userId, workspaceId, role, plan, account email, or
authorization scope. Tool arguments are sanitized before dispatch — any
`userId`, `workspaceId`, `role`, `plan`, `email`, `to`, or `recipient` fields
are stripped and can never override identity.

## 4. Tools

| Tool | Args | Description |
|---|---|---|
| `get_account_context` | — | Authenticated caller's account context (verified email, workspace role, plan). |
| `list_my_businesses` | — | Businesses the authenticated caller may access. |
| `get_business_summary` | `businessId?` | Compact profile + compliance counts for an authorized business. |
| `get_requirements` | `businessId?` | Authoritative requirements from the deterministic regulatory engine. |
| `get_missing_items` | `businessId?` | Incomplete or unresolved requirements for an authorized business. |
| `get_readiness` | `businessId?` | Overall + per-matter readiness scores. |
| `get_deadlines` | `businessId?` | Upcoming and overdue compliance deadlines. |
| `get_evidence_status` | `businessId?` | Evidence coverage and document review status. |
| `email_my_summary` | `businessId?` | Emails the summary to the verified account email. Never accepts a recipient. |
| `create_draft_project` | `businessId, projectType, description?, matterId?` | **Proposes** a draft project. Nothing persists until confirmed. |
| `propose_project_fact_update` | `businessId, factKey, factValue, matterId?` | **Proposes** a fact change (allowlisted keys only). Nothing persists until confirmed. |
| `add_note` | `businessId, noteText` | **Proposes** a note. Nothing persists until confirmed. |
| `confirm_pending_action` | `pendingActionId` | Confirms + executes a proposed action. Call only with the caller's explicit "yes". |
| `cancel_pending_action` | `pendingActionId` | Cancels a proposed action without executing it. |
| `send_secure_upload_link` | `businessId, obligationId?` | Emails a single-use evidence-upload link to the verified account email. |
| `send_secure_action_link` | `businessId, actionType, ...` | Emails a scoped secure-action link for link-only actions (government submission, signatures, etc.) to the verified account email. |
| `generate_deliverable` | `businessId, deliverableType` | Generates a readiness/requirements PDF (plan-gated). |
| `email_deliverable` | `businessId, deliverableId` | Emails a secure download link for a generated deliverable to the verified account email. |

`businessId` is optional: with exactly one accessible business it is
auto-selected; with several, the server returns `BUSINESS_SELECTION_REQUIRED`
with `{id, name}` options and Grok asks the caller. An explicitly supplied id
is re-verified against RBAC on every call — the model's remembered selection
is never trusted as authorization. `email_my_summary` with no `businessId`
covers the whole account (Phase 1 behavior).

## 5. Safe response contract

Tool results are returned as MCP text content blocks carrying this JSON:

```json
{ "success": true, "data": { "...": "..." } }
```

Failures set `isError: true` and carry:

| Code | Meaning | Caller hears |
|---|---|---|
| `AUTH_REQUIRED` | Missing/expired/revoked voice session | "Your phone session is no longer authenticated." |
| `FORBIDDEN` | Business not accessible to this user | "You do not have access to that business." |
| `PLAN_NOT_ENTITLED` | Plan restriction (`available_alternative` may be set) | Restriction + alternative |
| `BUSINESS_SELECTION_REQUIRED` | Ambiguous business (`options: [{id, name}]`) | "Which business do you mean?" |
| `NOT_FOUND` / `NO_BUSINESSES` | Resource absent | Plain-language message |
| `NO_VERIFIED_EMAIL` | No verified email on file | "No verified email is on file for this account." |
| `VALIDATION_ERROR` / `DELIVERY_FAILED` | Bad tool/args, email delivery failed | Plain-language message |
| `SERVICE_UNAVAILABLE` / `INTERNAL_ERROR` | DB down / unexpected | Generic message — never stack traces, SQL, secrets, or config |

## 6. xAI session configuration

Field names verified against the current xAI docs
(`docs.x.ai/developers/tools/remote-mcp`,
`docs.x.ai/developers/model-capabilities/audio/speech-to-speech`,
checked 2026-09-17). Remote MCP tools are supported in Speech-to-Speech via
`session.tools` with `type: "mcp"`. Supported parameters: `server_url`
(required, HTTPS; Streaming HTTP or SSE), `server_label` (required, used for
tool-call prefixing), `server_description`, `allowed_tools` (empty allows
all), `authorization` (token placed in the `Authorization` header), `headers`.

```json
{
  "type": "session.update",
  "session": {
    "instructions": "<agent instructions from §8>",
    "tools": [
      {
        "type": "mcp",
        "server_url": "https://<smartpr-host>/api/mcp/voice",
        "server_label": "smartpr",
        "server_description": "Authenticated SmartPR account tools: requirements, readiness, evidence, deadlines, draft projects, fact updates, notes, secure links, deliverables, and summary email.",
        "allowed_tools": [
          "get_account_context",
          "list_my_businesses",
          "get_business_summary",
          "get_requirements",
          "get_missing_items",
          "get_readiness",
          "get_deadlines",
          "get_evidence_status",
          "email_my_summary",
          "create_draft_project",
          "propose_project_fact_update",
          "add_note",
          "confirm_pending_action",
          "cancel_pending_action",
          "send_secure_upload_link",
          "send_secure_action_link",
          "generate_deliverable",
          "email_deliverable"
        ],
        "authorization": "<VOICE_SESSION_TOKEN>"
      }
    ]
  }
}
```

Note: `authorization` is the raw Phase 1 voice session token (`vs_…`). The
MCP server accepts it with or without the `Bearer ` prefix. The token is
short-lived (30 minutes); a fresh `session.update` with a new token is
required after expiry.

## 7. Session handoff (getting the token into xAI)

Preferred flow:

1. Inbound call → caller identification (phone lookup). Nobody is hung up
   on: every caller gets general regulatory help. The greeting invites
   premium PIN entry on the keypad — "if you have a SmartPR account with
   premium voice access, enter it now" — but never demands it, and never
   front-loads PIN jargon at callers who don't know what a PIN is.
2. PIN authentication via the Phase 1 gateway (`/api/voice/phone/verify-pin`)
   only when the caller actually enters 6 DTMF digits. The raw PIN is never
   exposed to Grok and never stored in conversation history. A PIN from a
   non-enrolled number keeps the caller in the free tier (no hangup).
3. SmartPR issues the voice session token server-side.
4. The telephony/gateway service opens the xAI realtime WebSocket and sends
   `session.update` with the MCP tool configuration above, embedding the
   fresh voice session token in `authorization`.
5. Grok may now use account-specific MCP tools for the duration of the call.

If the Grok realtime session already exists before PIN authentication
completes, send a second `session.update` adding the MCP tool entry after
successful authentication — `session.update` may be sent at any time after
session creation per the xAI docs. If authentication is absent or the token
expires mid-call, account tools return `AUTH_REQUIRED` and the agent falls
back to anonymous regulatory mode (§9) instead of failing the call.

## 8. Agent instructions

Keep the system prompt small — behavioral rules only:

> You are the conversational interface to SmartPR.
>
> For account-specific information, use the SmartPR MCP tools.
>
> SmartPR tool results are authoritative for account identity, permissions,
> subscription access, regulatory requirements, readiness, evidence,
> deadlines, and email actions.
>
> Never infer account data that was not returned by SmartPR.
>
> Never override a denied action.
>
> If SmartPR returns AUTH_REQUIRED, tell the caller authentication is required.
>
> If SmartPR returns FORBIDDEN, explain that the account does not have access
> to that resource.
>
> If SmartPR returns PLAN_NOT_ENTITLED, explain the restriction and offer any
> returned alternative.
>
> If several businesses are available and the caller has not identified one,
> ask which business they mean.
>
> Never ask the caller for user IDs, workspace IDs, database IDs, or plan names.
>
> Never ask the caller to dictate their PIN aloud.
>
> Never invent regulatory requirements outside SmartPR's authoritative
> regulatory engine.
>
> Action tools (`create_draft_project`, `propose_project_fact_update`,
> `add_note`) only PROPOSE. Read the confirmation summary back to the caller
> in plain language and ask for explicit confirmation. Only call
> `confirm_pending_action` with that pendingActionId when the caller gives an
> unambiguous yes; anything vague ("maybe", "I guess") is not confirmation.
> Never send a confirmation on the caller's behalf, never edit the proposal —
> confirm executes exactly what was proposed.
>
> Secure links and emails always go to the verified account email. Never ask
> for or accept a recipient address, phone number, user ID, workspace ID, or
> plan name. Never collect passwords, PINs, or verification codes.

## 9. Anonymous vs authenticated calls

Anonymous calling is preserved. Without a token, `initialize`/`tools/list`
still work; any account tool call returns `AUTH_REQUIRED` (a tool-level
error, not a transport failure), so the call continues. The agent moves
between **anonymous regulatory mode** (general regulatory questions through
the existing anonymous SmartPR regulatory path) and **authenticated SmartPR
mode** based on whether a valid voice session exists.

## 10. Observability

`data/voice_phase2_schema.sql` adds `voice_tool_calls`:

- `tool_name`, `session_id`, `user_id`, `business_id`
- `success`, `error_code`, `denial_kind`
  (`auth` | `forbidden` | `plan` | `selection` | `validation` |
  `not_found` | `delivery` | `internal`)
- `latency_ms`, `email_sent`, `created_at`

Never logged: tokens, PINs, raw arguments, PII beyond the business id.
Phase 1 audit (`voice_audit_log`) and usage (`voice_usage`) rows continue to
be written for every tool call. The observability write is best-effort — it
can never break a tool call (e.g. before the migration is applied).

## 11. Security tests

`frontend/src/lib/voice/mcp.test.ts` (35 tests) proves:

- MCP cannot override userId / workspaceId / role / plan (args stripped)
- MCP cannot choose an arbitrary email recipient (verified-email-only)
- MCP cannot access another user's business (`FORBIDDEN`, denial audited)
- MCP cannot access another workspace
- MCP cannot execute undeclared tools
- Expired and revoked tokens fail (`AUTH_REQUIRED`)
- Every tool call writes audit + usage + `voice_tool_calls` rows
- Failures never leak SQL, stack traces, or secrets
- Protocol: version negotiation, `tools/list`, `ping`, unknown methods,
  notifications, malformed payloads

## 12. End-to-end acceptance test

Phase 2 is complete only when this works against production-like infra:

1. Existing SmartPR user calls.
2. User authenticates using Phase 1 phone access.
3. Grok receives MCP access scoped to the voice session (`session.update`).
4. Caller: "What am I still missing for my business?"
5. Grok calls `get_missing_items` (selecting the business first if needed).
6. SmartPR verifies session + RBAC.
7. SmartPR returns current missing items; Grok explains them.
8. Caller: "Email that to me."
9. Grok calls `email_my_summary`.
10. SmartPR sends only to the verified account email.
11. Audit and usage records are written.
12. Caller never needed to log into the website.

## 13. Phase 3 — action tools (implemented, unapplied migration)

Phase 3 adds confirmation-gated writes. Every write tool (draft projects,
fact updates, notes) only *proposes*: the server stores a frozen pending
action with a 15-minute expiry, and the caller must give an unambiguous "yes"
before `confirm_pending_action` executes the exact frozen payload. Sensitive
actions (government submission, signatures, attestations, payments, security
changes, destructive actions, workspace administration) are
secure-link-only — never executed by voice. Emails and secure links always go
to the verified account email; no arbitrary recipients.

Tests: `frontend/src/lib/voice/phase3.test.ts` (27 tests) proves the
confirmation architecture — frozen payloads, same-session binding, expiry,
cancellation, double-confirm idempotency, fact provenance, engine reruns
with before/after diffs, plan gating, verified-email-only delivery, scoped
expiring single-use links, RBAC denials, and safe failure codes.

Still out of scope: government automation/automatic filing, payments,
signatures, legal attestations, arbitrary profile changes, workspace
security management, arbitrary recipients, unrestricted deletion,
unconfirmed autonomous changes, binary uploads through the voice model.

## 12. Production telephony gateway (implemented 2026-09-17)

The xAI-side wiring is implemented in the Next.js app (no separate service):

- `src/app/api/voice/xai-webhook/route.ts` — receives `realtime.call.incoming`,
  verifies the Standard Webhooks signature (`XAI_WEBHOOK_SECRET`), and hands
  the call to the manager detached so the webhook returns 200 immediately.
- `src/lib/voice/xaiCallManager.ts` — per-call lifecycle: opens
  `wss://api.x.ai/v1/realtime?call_id=…&agent_id=…` with `XAI_API_KEY`
  (`agent_id` loads the saved console agent's config, per the xAI console
  "Code integration" pattern; env `XAI_AGENT_ID` overrides the default
  `agent_MDinRE52EURHvKZV`, empty string disables it), runs the pre-auth
  session (tools explicitly cleared so no console-configured tools leak in
  before authentication). Every caller gets a general-help greeting that
  mentions the PIN only as the premium path; entering 6 DTMF digits triggers
  `/api/voice/phone/verify-pin` server-side, the raw PIN never reaches the
  model (input buffer cleared + history scrubbed). On success the authed
  `session.update` attaches the 18 MCP tools (`authorization` = fresh `vs_…`
  token); a PIN from a non-enrolled number stays in the free tier with no
  hangup. There is no authentication timeout — free-tier callers
  legitimately never enter a PIN. Revokes the session on hangup.
- `src/lib/voice/xaiRealtime.ts` — pure helpers (payload builders, signature
  verification, DTMF collector) with unit tests in `xaiRealtime.test.ts`.

Railway env required: `XAI_API_KEY` (existing), `VOICE_GATEWAY_API_KEY`
(existing), `XAI_WEBHOOK_SECRET` (dispatch signing secret from the xAI phone
number registration). xAI console: point the number's webhook at
`https://www.getsmartpr.com/api/voice/xai-webhook`.
