# SmartPR Remote MCP Server — Phase 2

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
        "server_description": "Authenticated SmartPR account tools: requirements, readiness, evidence, deadlines, and summary email.",
        "allowed_tools": [
          "get_account_context",
          "list_my_businesses",
          "get_business_summary",
          "get_requirements",
          "get_missing_items",
          "get_readiness",
          "get_deadlines",
          "get_evidence_status",
          "email_my_summary"
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

1. Inbound call → caller identification (phone lookup).
2. PIN authentication via the Phase 1 gateway (`/api/voice/phone/verify-pin`).
   The raw PIN is never exposed to Grok and never stored in conversation
   history.
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
back to anonymous regulatory mode (§10) instead of failing the call.

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

## 13. Explicitly out of scope (Phase 3+)

Payments, government filing submission, electronic signature, arbitrary
passport edits, workspace administration, billing modification, destructive
actions, user invitations, document deletion, unrestricted uploads through
voice. Phase 2 is read-heavy by design; `email_my_summary` is the only write,
and it was already a Phase 1 capability.
