# SmartPR Voice Phase 1 + Phase 2 — Production Verification Runbook

**Scope:** verify the implemented authenticated phone + MCP architecture end to
end in a production-like environment. No new features, no architecture
changes. If a capability is missing, record it as a gap — do not build around
it.

**Notation used throughout**

| Placeholder | Meaning |
|---|---|
| `<HOST>` | Production app origin, e.g. `https://www.getsmartpr.com` |
| `<GATEWAY_KEY>` | `VOICE_GATEWAY_API_KEY` value (type it; never paste into chat/logs) |
| `<VS_TOKEN>` | Voice session token returned by `verify-pin` (opaque, `vs_…`) |
| USER-A | Test user, one business, Free plan, verified email |
| USER-B | Second test user, different business, used for cross-user denial |
| USER-M | Multi-business user (or Partner workspace member) |
| SQL | Run in the Supabase SQL editor against the production project |

**Commit under test:** record the deployed Railway commit SHA here before
starting: `____________`

---

## 0. Preflight checklist

- [ ] Both migrations applied to Supabase: `data/voice_phone_access_schema.sql`
      **and** `data/voice_phase2_schema.sql`
- [ ] `VOICE_GATEWAY_API_KEY` set in the production app environment
- [ ] Gmail SMTP configured (summary emails deliver)
- [ ] Test accounts exist: USER-A, USER-B, USER-M with verified emails,
      known businesses, and known compliance state
- [ ] Tester has Supabase SQL-editor access and Railway deploy visibility
- [ ] A phone-call path exists for the live test (or the gateway endpoints
      are exercised directly with `<GATEWAY_KEY>`)

---

## 1. Database verification

**T-01 — Tables exist**

- Pre: Supabase SQL editor open.
- Action:
  ```sql
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('voice_access','voice_sessions','voice_audit_log',
                       'voice_usage','voice_tool_calls')
  ORDER BY 1;
  ```
- Expected: all five rows returned.
- Evidence: query output screenshot/row count = 5.
- ☐ PASS ☐ FAIL — notes: ___

**T-02 — Columns, keys, indexes match the implemented schema**

- Pre: T-01 passed.
- Action:
  ```sql
  -- voice_access: no plaintext PIN; lockout fields present
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'voice_access' ORDER BY ordinal_position;
  -- voice_sessions: hash-only token storage; expiry + revocation fields
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'voice_sessions' ORDER BY ordinal_position;
  -- voice_tool_calls: observability, no secret columns
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'voice_tool_calls' ORDER BY ordinal_position;
  SELECT indexname FROM pg_indexes
  WHERE tablename IN ('voice_access','voice_sessions','voice_audit_log',
                      'voice_usage','voice_tool_calls') ORDER BY 1;
  ```
- Expected:
  - `voice_access`: `user_id` PK, `phone_e164` unique, `pin_hash TEXT NOT NULL`,
    `failed_attempts`, `locked_until`, `enabled`, `last_verified_at`, `email`.
    **No column named `pin` / `pin_plaintext` / `pin_code`.**
  - `voice_sessions`: `id` PK, `token_hash TEXT NOT NULL UNIQUE`,
    `expires_at`, `revoked_at`, `revoke_reason`, `last_used_at`.
    **No column storing the raw token.**
  - `voice_tool_calls`: `tool_name`, `session_id` (FK → `voice_sessions.id`
    `ON DELETE SET NULL`), `user_id`, `business_id`, `success`, `error_code`,
    `denial_kind`, `latency_ms`, `email_sent`, `created_at`.
    **No token/PIN/secret column.**
  - `voice_audit_log`: `user_id`, `phone_e164`, `action`, `details` (jsonb),
    `ip`, `created_at`.
  - `voice_usage`: PK `(user_id, day)`; counters `calls`, `tool_calls`,
    `emails_sent`.
- Evidence: column listings; explicit `SELECT` confirming absence, e.g.
  ```sql
  SELECT count(*) FROM information_schema.columns
  WHERE table_name IN ('voice_access','voice_sessions','voice_tool_calls')
    AND column_name ILIKE '%plain%' OR column_name IN ('pin','token','secret');
  ```
  must return 0.
- ☐ PASS ☐ FAIL — notes: ___

**T-03 — Stored values are hashes, never plaintext**

- Pre: at least one enrolled test user and one issued session exist (run §4–§6 first if needed, then return here).
- Action:
  ```sql
  SELECT left(pin_hash, 24) AS pin_hash_prefix, length(pin_hash) AS len
  FROM voice_access LIMIT 3;
  SELECT left(token_hash, 24) AS token_hash_prefix, length(token_hash) AS len
  FROM voice_sessions LIMIT 3;
  ```
- Expected: `pin_hash` is a long scrypt envelope (not 6 digits);
  `token_hash` is a 64-char hex SHA-256 digest, never starting with `vs_`.
- Evidence: query output.
- ☐ PASS ☐ FAIL — notes: ___

---

## 2. Deployment verification

**T-04 — Deployed commit and health**

- Pre: Railway project access.
- Action: confirm the production deployment is running the intended commit
  SHA (record in the header); `GET <HOST>/api/health` (or equivalent) → 200.
- Expected: SHA matches; health 200.
- Evidence: Railway deploy SHA + health response.
- ☐ PASS ☐ FAIL — notes: ___

**T-05 — Endpoints reachable, secrets present-but-unprinted**

- Pre: T-04 passed.
- Action:
  - `POST <HOST>/api/mcp/voice` with `{"jsonrpc":"2.0","id":1,"method":"ping"}`
    → 200 `{"result":{}}`.
  - `POST <HOST>/api/voice/phone/lookup` **without** gateway key → 401
    `gateway_unauthorized`.
  - Open Phone Access settings page as USER-A → loads.
  - In Railway env dashboard: `VOICE_GATEWAY_API_KEY` is **set** (value hidden),
    Gmail SMTP vars set, xAI values configured per `docs/voice-mcp.md` §6
    (record which fields are configured, not their values).
- Expected: MCP answers ping; gateway routes reject unauthenticated callers;
  settings UI loads; required env vars present.
- Evidence: response codes; env presence checklist (no values copied).
- ☐ PASS ☐ FAIL — notes: ___

---

## 3. Phone Access enrollment (USER-A)

**T-06 — Enable Phone Access**

- Pre: logged in as USER-A (verified email known).
- Action: Settings → Phone Access → enter `7875551212` → create PIN `482916`,
  confirm `482916` → save.
- Expected:
  - Number normalized to `+17875551212` (display may keep formatting).
  - No PIN visible after save (masked inputs only).
  - DB: `voice_access` row for USER-A: `enabled=true`,
    `phone_e164='+17875551212'`, `pin_hash` = scrypt envelope,
    `failed_attempts=0`, `locked_until=NULL`.
- Evidence:
  ```sql
  SELECT enabled, phone_e164, failed_attempts, locked_until,
         left(pin_hash,12) FROM voice_access WHERE user_id = '<USER-A id>';
  ```
- ☐ PASS ☐ FAIL — notes: ___

**T-07 — Change PIN**

- Pre: T-06 passed.
- Action: change PIN to `730415` (must supply current PIN `482916`).
- Expected: `pin_hash` changes; old PIN `482916` no longer verifies (§6);
  new PIN verifies.
- Evidence: `updated_at` advanced; verify-pin with old PIN → 401.
- ☐ PASS ☐ FAIL — notes: ___

**T-08 — Reset PIN (authenticated-web forgotten flow)**

- Pre: T-07 passed.
- Action: use the reset flow to set PIN `209384`.
- Expected: `failed_attempts` reset to 0, `locked_until` cleared,
  new `pin_hash` stored; audit shows the reset.
- Evidence:
  ```sql
  SELECT failed_attempts, locked_until FROM voice_access WHERE user_id='<USER-A id>';
  SELECT action, created_at FROM voice_audit_log
  WHERE user_id='<USER-A id>' ORDER BY created_at DESC LIMIT 5;
  ```
- ☐ PASS ☐ FAIL — notes: ___

**T-09 — Disable, then re-enable**

- Pre: T-08 passed; issue a session first (§6) so revocation is observable.
- Action: Disable Phone Access → attempt `verify-pin` → re-enable with PIN `611207`.
- Expected:
  - On disable: `enabled=false`; **all** outstanding `voice_sessions` for
    USER-A get `revoked_at` set with `revoke_reason='access_disabled'`.
  - `verify-pin` while disabled → rejected.
  - Re-enable works; new PIN verifies.
- Evidence:
  ```sql
  SELECT enabled FROM voice_access WHERE user_id='<USER-A id>';
  SELECT revoked_at, revoke_reason FROM voice_sessions
  WHERE user_id='<USER-A id>' ORDER BY issued_at DESC LIMIT 3;
  ```
- ☐ PASS ☐ FAIL — notes: ___

---

## 4. Phone normalization

**T-10 — PR/US formats converge**

- Pre: Phone Access disabled or a fresh test number (normalization is
  testable at enrollment; use numbers that do not collide).
- Action: enroll each of `7875551212`, `(787) 555-1212`, `+1 787 555 1212`,
  `1-787-555-1212` (one per test account, or sequentially re-enrolling).
- Expected: every variant stores `phone_e164 = '+17875551212'`.
- Evidence: `SELECT phone_e164 FROM voice_access …` for each.
- ☐ PASS ☐ FAIL — notes: ___

**T-11 — Malformed input rejected**

- Pre: enrollment form open.
- Action: try `123`, `787-ABC-1212`, a 20-digit string, empty.
- Expected: clean validation error; no `voice_access` row written/changed;
  no 500.
- Evidence: UI message + DB unchanged.
- ☐ PASS ☐ FAIL — notes: ___

---

## 5. PIN authentication

**T-12 — Successful verify-pin**

- Pre: USER-A Phone Access enabled, PIN known (`611207` after T-09),
  `locked_until` NULL.
- Action:
  ```bash
  curl -s -X POST <HOST>/api/voice/phone/verify-pin \
    -H "Authorization: Bearer <GATEWAY_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"phone":"+17875551212","pin":"611207"}'
  ```
  Save the returned `session_token` as `<VS_TOKEN>`.
- Expected:
  - 200 with `{ session_token: "vs_…", token_type: "bearer", expires_at }`.
  - Token is opaque (no user id, phone, or email embedded).
  - `expires_at` ≈ now + 30 minutes.
  - DB: `voice_sessions` row with `token_hash` = SHA-256 of the token,
    `revoked_at` NULL; any prior sessions for USER-A now
    `revoke_reason='superseded'`.
  - `voice_access.failed_attempts = 0`; audit has `session_issued`;
    `voice_usage.calls` incremented for today.
  - Response and logs contain no PIN.
- Evidence:
  ```sql
  SELECT expires_at - issued_at AS ttl, revoked_at, revoke_reason
  FROM voice_sessions WHERE user_id='<USER-A id>' ORDER BY issued_at DESC LIMIT 3;
  SELECT action FROM voice_audit_log WHERE user_id='<USER-A id>'
  ORDER BY created_at DESC LIMIT 3;
  ```
- ☐ PASS ☐ FAIL — notes: ___

---

## 6. Incorrect PIN + lockout

Run against USER-A (re-enable + fresh PIN if needed). Use wrong PIN `000000`.

**T-13 — Attempts 1–4 rejected generically**

- Pre: `failed_attempts = 0`, `locked_until` NULL.
- Action: `verify-pin` with wrong PIN, four times.
- Expected: each → 401 `{ error: "invalid_pin", attempts_remaining: 4,3,2,1 }`;
  `failed_attempts` increments 1→4 atomically; audit rows `pin_failed`;
  no PIN in any log.
- Evidence:
  ```sql
  SELECT failed_attempts, locked_until FROM voice_access WHERE user_id='<USER-A id>';
  ```
- ☐ PASS ☐ FAIL — notes: ___

**T-14 — 5th attempt triggers 15-minute lockout**

- Action: 5th wrong PIN.
- Expected: 423 `{ error: "locked", retry_after_seconds: 900 }`;
  `locked_until` ≈ now + 15 min; audit row `pin_locked`.
- Evidence: response body + `SELECT locked_until …`.
- ☐ PASS ☐ FAIL — notes: ___

**T-15 — Correct PIN rejected during lockout; anonymous unaffected**

- Action: `verify-pin` with the **correct** PIN while locked; then call MCP
  `tools/list` with no auth.
- Expected: correct PIN → 423 (still locked). `tools/list` → 200 with the
  nine tools (anonymous discovery unaffected).
- Evidence: both responses.
- ☐ PASS ☐ FAIL — notes: ___

**T-16 — Recovery after lockout**

- Action: wait 15 min (or, in staging only, clear `locked_until` manually —
  record which), then `verify-pin` with correct PIN.
- Expected: 200, fresh session; `failed_attempts=0`, `locked_until=NULL`.
- Evidence: DB row.
- ☐ PASS ☐ FAIL — notes: ___

> Note: `verify-pin` returns 404 `not_enrolled` for unknown phones vs 401 for
> wrong PINs. This distinction is only reachable with the trusted
> `<GATEWAY_KEY>` (public callers get 401 `gateway_unauthorized`), so it is
> not a public enumeration vector. Record here if that assumption ever changes.

---

## 7. Session validation

Use `<VS_TOKEN>` from T-12 (re-issue if expired). Exercise via MCP
`tools/call → get_account_context`.

**T-17 — Matrix**

| # | Token used | Expected |
|---|---|---|
| A | valid `<VS_TOKEN>` | `success:true`, account context |
| B | random `vs_` + 43 chars | `success:false`, `AUTH_REQUIRED` |
| C | expired session (wait 30 min or craft via old session) | `AUTH_REQUIRED` |
| D | revoked session (revoke first, §8) | `AUTH_REQUIRED` |
| E | `not-a-token`, empty, missing header | `AUTH_REQUIRED` |
| F | USER-B's valid token used against USER-A-only assertions (call `get_account_context`) | `success:true` **but scoped to USER-B** — context must show USER-B's email/plan, never USER-A's |

- Pre: sessions in the required states.
- Action: `tools/call` per row.
- Expected: no stack trace, no SQL, no internal paths in any failure body;
  F proves tokens are bound to their own user (server-derived identity).
- Evidence: response bodies for A–F.
- ☐ PASS ☐ FAIL — notes: ___

---

## 8. Session revocation

**T-18 — Explicit revoke**

- Pre: valid `<VS_TOKEN>`.
- Action:
  ```bash
  curl -s -X POST <HOST>/api/voice/session/revoke \
    -H "Authorization: Bearer <GATEWAY_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"session_token":"<VS_TOKEN>","reason":"test_revoke"}'
  ```
  Then `tools/call → get_account_context` with `<VS_TOKEN>`.
- Expected: revoke → `{ revoked: true }` (idempotent — repeat returns the
  same). Follow-up tool call → `AUTH_REQUIRED`. DB: `revoked_at` set,
  `revoke_reason='test_revoke'`; audit row `session_revoked`.
- Evidence: responses + SQL.
- ☐ PASS ☐ FAIL — notes: ___

**T-19 — Hangup revocation status**

- Action: inspect — there is **no telephony hangup webhook** in the current
  implementation; revocation happens via the gateway calling
  `/api/voice/session/revoke` at call end, or via Disable Phone Access.
- Expected: record as **follow-up**: wire hangup → revoke when telephony
  lands. Do not mark the architecture failed for this; mark the gap.
- ☐ Documented as follow-up ☐

---

## 9. MCP initialize

**T-20 — initialize negotiates cleanly, no auth, no leaks**

- Pre: none.
- Action:
  ```bash
  curl -s -X POST <HOST>/api/mcp/voice \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
         "params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"runbook","version":"1"}}}'
  ```
  Repeat with `"2025-03-26"`, `"2024-11-05"`, and a bogus `"1999-01-01"`.
- Expected: 200 valid JSON-RPC 2.0; echoes each supported version;
  bogus → latest (`2025-06-18`); `serverInfo.name="smartpr-voice"`;
  no `Authorization` header needed; body contains zero account data and zero
  internal paths/versions beyond the server name.
- Evidence: four response bodies.
- ☐ PASS ☐ FAIL — notes: ___

---

## 10. MCP tools/list

**T-21 — Exactly the nine curated tools**

- Action: `tools/list` (no auth).
- Expected: exactly these nine, each with `name`, `description`,
  `inputSchema`:
  `get_account_context`, `list_my_businesses`, `get_business_summary`,
  `get_requirements`, `get_missing_items`, `get_readiness`, `get_deadlines`,
  `get_evidence_status`, `email_my_summary`.
  **Absent:** `run_sql`, `database_query`, `execute_code`, `arbitrary_http`,
  `filesystem`, `admin_query`, `user_lookup_by_id`, or anything similar.
  No schema declares `userId`/`workspaceId`/`role`/`plan`/`email`/`recipient`.
  No account-specific data in the response.
- Evidence: full `tools/list` body.
- ☐ PASS ☐ FAIL — notes: ___

---

## 11. Authenticated MCP tool call + override resistance

**T-22 — get_account_context derives identity server-side**

- Pre: fresh `<VS_TOKEN>` for USER-A.
- Action:
  ```bash
  curl -s -X POST <HOST>/api/mcp/voice \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <VS_TOKEN>" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
         "params":{"name":"get_account_context","arguments":{
           "userId":"evil","workspaceId":"evil","role":"OWNER",
           "plan":"enterprise","email":"evil@x.com"}}}'
  ```
- Expected: `success:true`; `data.email` = USER-A's verified email;
  `data.plan` = USER-A's real plan (not `enterprise`); no `userId`/
  `workspaceId` echo; override fields ignored/stripped.
- Evidence: response body.
- ☐ PASS ☐ FAIL — notes: ___

**T-23 — raw token (no Bearer prefix) also works**

- Action: repeat T-22 with `Authorization: <VS_TOKEN>` (no `Bearer `).
- Expected: same success (xAI sends the configured value as-is).
- Evidence: response body.
- ☐ PASS ☐ FAIL — notes: ___

---

## 12. list_my_businesses

**T-24 — Single-business user**

- Pre: USER-A has exactly one business.
- Action: `tools/call → list_my_businesses` as USER-A.
- Expected: exactly that business; fields limited to id/public_id/name/
  legal_name/business_type/municipality; no other user's business.
- Evidence: response body.
- ☐ PASS ☐ FAIL — notes: ___

**T-25 — Multi-business / professional workspace**

- Pre: USER-M with several businesses (incl. a professional workspace role).
- Action: `tools/call → list_my_businesses` as USER-M.
- Expected: only businesses USER-M may access (owner or workspace member,
  not archived); role restrictions honored; nothing from other workspaces.
- Evidence: response body vs. web dashboard business list.
- ☐ PASS ☐ FAIL — notes: ___

---

## 13. Business selection

**T-26 — Auto-select single business**

- Pre: USER-A, one business.
- Action: `tools/call → get_missing_items` with `"arguments": {}`.
- Expected: `success:true` for USER-A's business (no selection prompt).
- Evidence: response body shows correct `business_name`.
- ☐ PASS ☐ FAIL — notes: ___

**T-27 — Ambiguity requires selection**

- Pre: USER-M, ≥2 businesses.
- Action: `tools/call → get_missing_items` with `"arguments": {}`.
- Expected: `success:false`, `code: "BUSINESS_SELECTION_REQUIRED"`,
  `options: [{id, name}, …]` listing **only** USER-M's authorized businesses.
- Evidence: response body.
- ☐ PASS ☐ FAIL — notes: ___

---

## 14. Cross-user denial (USER-A → USER-B's business)

Get USER-B's business id from USER-B's own `list_my_businesses`
(never from USER-A's context).

**T-28 — Denial matrix (repeat per tool)**

For each of `get_business_summary`, `get_requirements`, `get_missing_items`,
`get_readiness`, `get_deadlines`, `get_evidence_status`, `email_my_summary`:
call as USER-A with `{"businessId":"<USER-B business id>"}`.

- Expected every time: `success:false`, `code:"FORBIDDEN"`,
  message "You do not have access to that business." No business name,
  address, or partial data leaks. No stack trace.
- Evidence (after the matrix):
  ```sql
  SELECT action, details->>'tool' AS tool, created_at
  FROM voice_audit_log
  WHERE user_id='<USER-A id>' AND action='tool_call'
  ORDER BY created_at DESC LIMIT 10;  -- expect business_access_denied entries
  SELECT tool_name, success, error_code, denial_kind
  FROM voice_tool_calls WHERE user_id='<USER-A id>'
  ORDER BY created_at DESC LIMIT 10;  -- expect success=false, FORBIDDEN
  ```
- ☐ PASS ☐ FAIL — notes: ___

---

## 15. Cross-workspace denial

**T-29 — Workspace boundary + enterprise non-bypass**

- Pre: USER-A in Workspace A; a business exists in Workspace B (USER-A is not
  a member). If available, an Enterprise-plan test user.
- Action: as USER-A (and separately as the Enterprise user if not a member
  of Workspace B), call `get_business_summary` with the Workspace B
  business id.
- Expected: `FORBIDDEN` in all cases — Enterprise/unlimited plan does **not**
  bypass workspace RBAC.
- Evidence: response bodies.
- ☐ PASS ☐ FAIL — notes: ___

---

## 16. Plan enforcement

> Current implementation fact: **no Phase 2 tool has a plan gate** —
> all nine tools (including `email_my_summary`, per the Phase 1 decision)
> are available on every plan. Recurring compliance reminders remain
> paid-gated elsewhere. Verify behavior matches this; do not invent gates.

**T-30 — Free plan**

- Pre: USER-A on Free.
- Action: call `get_requirements`, `get_missing_items`, `get_readiness`,
  `get_deadlines`, `get_evidence_status`, `email_my_summary`.
- Expected: all succeed; email delivers; no paid-only capability appears.
- Evidence: six response bodies + received email.
- ☐ PASS ☐ FAIL — notes: ___

**T-31 — Core / Operator / Partner / Enterprise / Pilot**

- Action: repeat the read set for one user on each plan; for Partner,
  confirm portfolio scoping (only authorized client businesses); for
  Enterprise, confirm RBAC still enforced (T-29).
- Expected: same read behavior everywhere; no plan bypasses RBAC;
  existing plan entitlements (Radar, deliverables) untouched.
- Evidence: response bodies per plan.
- ☐ PASS ☐ FAIL — notes: ___

---

## 17. The remaining tools vs. web truth

For T-32–T-36: Pre = USER-A authenticated, business id known. For each tool,
compare the MCP result field-by-field against the SmartPR web UI for the same
business. Any divergence is a NO-GO (authoritative-engine mismatch).

**T-32 — get_business_summary** — profile fields, requirement counts,
overdue count, evidence count match web; no unnecessary PII.
☐ PASS ☐ FAIL — notes: ___

**T-33 — get_requirements** — requirements match the deterministic engine /
web output for identical facts. Cover: a business with known requirements,
a conditional requirement, a verified requirement, and a missing-facts case.
**Voice/MCP must not invent requirements.**
☐ PASS ☐ FAIL — notes: ___

**T-34 — get_missing_items** — only incomplete/unresolved items; statuses
match web; nothing fabricated; nothing completed shown as missing.
☐ PASS ☐ FAIL — notes: ___

**T-35 — get_readiness** — score matches web; same requirement basis and
evidence state; no voice-specific calculation.
☐ PASS ☐ FAIL — notes: ___

**T-36 — get_deadlines** — only authorized deadlines; dates match SmartPR;
no invented expiry dates (unknown = no date, per reminders policy).
☐ PASS ☐ FAIL — notes: ___

**T-37 — get_evidence_status** — evidence states (approved/pending/rejected)
match the locker; no other business's documents. Ask the natural question
"Do you already have my fire certificate?" via the tool and confirm the
answer matches stored evidence.
☐ PASS ☐ FAIL — notes: ___

---

## 18. email_my_summary — release-critical

**T-38 — Recipient injection is impossible**

- Pre: USER-A authenticated.
- Action:
  ```bash
  # arguments include hostile recipient fields
  {"name":"email_my_summary","arguments":{
    "businessId":"<USER-A business id>",
    "recipient":"attacker@example.com",
    "email":"attacker@example.com",
    "to":"attacker@example.com"}}
  ```
- Expected: `success:true`, `sent:true`; the email arrives **only** at
  USER-A's verified account email; content references only USER-A's
  business(es); attacker address receives nothing.
- Evidence: received email headers (To: = USER-A's email); DB:
  ```sql
  SELECT action, details FROM voice_audit_log
  WHERE user_id='<USER-A id>' AND action='email_sent'
  ORDER BY created_at DESC LIMIT 1;   -- details.to_domain = USER-A's domain only
  SELECT tool_name, success, email_sent FROM voice_tool_calls
  WHERE user_id='<USER-A id>' ORDER BY created_at DESC LIMIT 1;
  ```
- ☐ PASS ☐ FAIL — notes: ___

**T-39 — Grok only claims success on actual send; SMTP failure is safe**

- Action: if practical, break SMTP (bad credential in staging) and call
  `email_my_summary`.
- Expected: `success:false` (safe failure, e.g. delivery failure) — Grok must
  **not** say the email was sent. Restore SMTP afterwards.
- Evidence: failure body; no email received.
- ☐ PASS ☐ FAIL — notes: ___ (N/A if not practical: ___)

---

## 19. Observability — voice_tool_calls

**T-40 — One row per call, no secrets**

- Pre: several tool calls made above (success + denials + email).
- Action:
  ```sql
  SELECT tool_name, success, error_code, denial_kind, email_sent,
         latency_ms >= 0 AS latency_ok, created_at,
         session_id IS NOT NULL AS has_session
  FROM voice_tool_calls ORDER BY created_at DESC LIMIT 15;
  ```
- Expected: every call represented with correct tool name, success flag,
  denial kind (`auth`/`forbidden`/`selection`/…), latency ≥ 0,
  `email_sent=true` only for the email tool, timestamps sane.
  **No row contains a raw token, PIN, API key, or secret** — spot-check
  `details`-adjacent columns and confirm `business_id` is the only
  argument-like field stored.
- Evidence: query output.
- ☐ PASS ☐ FAIL — notes: ___

---

## 20. Audit log

**T-41 — All security-relevant actions audited**

- Action:
  ```sql
  SELECT action, count(*) FROM voice_audit_log
  WHERE created_at > now() - interval '2 hours'
  GROUP BY 1 ORDER BY 1;
  ```
- Expected: rows present for `session_issued`, `pin_failed`, `pin_locked`
  (if T-14 ran), `session_revoked` (if T-18 ran), `tool_call` (reads),
  `business_access_denied` (inside `tool_call` details), `email_sent`.
  Entries identify user/phone where appropriate; **no PINs, tokens, or
  secrets** in `details` (spot-check with
  `SELECT details FROM voice_audit_log ORDER BY created_at DESC LIMIT 20;`).
- Evidence: grouped counts + details sample.
- ☐ PASS ☐ FAIL — notes: ___

---

## 21. Usage logging

**T-42 — voice_usage counters**

- Action:
  ```sql
  SELECT user_id, day, calls, tool_calls, emails_sent FROM voice_usage
  WHERE day = CURRENT_DATE ORDER BY user_id;
  ```
- Expected: `calls` incremented on each `verify-pin` success; `tool_calls`
  on each tool call; `emails_sent` on each sent summary. Counters are
  per-user per-day.
- Known gap: live-telephony call **duration** callbacks are not wired
  (no telephony yet) — mark pending, do not fail the runbook for it.
- Evidence: query output.
- ☐ PASS ☐ FAIL — notes: ___

---

## 22. Anonymous fallback

**T-43 — Unauthenticated regulatory questions still work**

- Pre: no token.
- Action:
  - MCP `tools/call → get_missing_items` with no `Authorization` header →
    expect `success:false`, `code:"AUTH_REQUIRED"` (tool-level, call survives).
  - Via the voice agent (or the anonymous SmartPR regulatory path):
    "What permits do I need to open a restaurant in Bayamón?" → expect a
    general regulatory answer.
  - "What documents do I personally still need?" → expect an
    authentication-required response, not account data.
- Expected: anonymous mode answers general questions; account questions
  demand auth; nothing in between leaks.
- Evidence: MCP body + agent transcripts.
- ☐ PASS ☐ FAIL — notes: ___

---

## 23. xAI MCP connection

**T-44 — Live Grok ↔ SmartPR wiring**

- Pre: deployed `<HOST>`, fresh `<VS_TOKEN>` for USER-A, xAI realtime access.
- Action: configure the Grok Speech-to-Speech session per `docs/voice-mcp.md`
  §6 (`type:"mcp"`, `server_url=https://<HOST>/api/mcp/voice`,
  `server_label:"smartpr"`, the nine `allowed_tools`,
  `authorization:"<VS_TOKEN>"`, agent instructions from §8).
- Expected:
  - MCP connects; exactly the nine allowed tools load (no extras).
  - The `Authorization` header reaches SmartPR (tool calls succeed).
  - Grok executes a tool and speaks the returned result accurately.
- Evidence: record the exact xAI config used (**secret redacted**), plus a
  transcript excerpt.
- ☐ PASS ☐ FAIL — notes: ___

---

## 24. End-to-end live acceptance

**T-45 — Call → PIN → MCP → missing → evidence → readiness → email → revoke**

Test account: verified email, Phone Access enabled, known PIN, ≥1 business
with a known missing requirement, known readiness, ≥1 evidence item.

1. Call the SmartPR number (or simulate via gateway + xAI session).
2. Authenticate with the PIN → voice session created (DB check).
3. "What am I missing?" → Grok calls `get_missing_items`; SmartPR validates
   session + RBAC; Grok explains **only** returned items.
4. "Why do I need the first one?" → answer comes from SmartPR requirement
   data only; nothing invented.
5. "Do you already have my fire certificate?" → `get_evidence_status`
   matches stored evidence.
6. "What's my readiness?" → actual SmartPR readiness spoken.
7. "Email that to me." → `email_my_summary`; email arrives **only** at the
   verified account email.
8. Verify: email received; `voice_audit_log` rows; `voice_tool_calls` rows;
   `voice_usage` counters; no secrets anywhere.
9. End the call → revoke via `/api/voice/session/revoke`; reuse of the token
   → `AUTH_REQUIRED`.

- Expected: all nine steps behave as described; caller never logs into the website.
- Evidence: transcript + DB checks from T-40–T-42 + received email.
- ☐ PASS ☐ FAIL — notes: ___

**T-46 — Multi-business live test**

- Pre: USER-M with ≥2 businesses.
- Action: "What am I missing?" → Grok asks which business → caller names one
  → follow-ups stay scoped → caller switches businesses mid-call.
- Expected: correct business each time; backend re-verifies access per call;
  no data crosses between businesses.
- Evidence: transcript + `voice_tool_calls.business_id` sequence.
- ☐ PASS ☐ FAIL — notes: ___

---

## 25. Failure tests

**T-47 — Graceful degradation matrix**

| # | Fault | Expected |
|---|---|---|
| A | MCP endpoint down (stop route/staging) | xAI tool error surfaces; agent falls back to anonymous mode; no crash |
| B | Database unavailable | `SERVICE_UNAVAILABLE`-style safe message; no SQL/stack/env leak |
| C | Expired / revoked session mid-call | `AUTH_REQUIRED`; agent asks to re-authenticate |
| D | SMTP down | email tool fails safe; Grok does **not** claim sent |
| E | Invalid business id | `FORBIDDEN` or `NOT_FOUND`; no data leak |
| F | Malformed JSON-RPC / unknown method / batch array | JSON-RPC `-32700`/`-32600`/`-32601`; HTTP 400 where applicable |
| G | `GET /api/mcp/voice` | 405 |

- Expected: every failure is a structured safe error — never a stack trace,
  SQL text, environment variable, secret, or internal file path.
- Evidence: response bodies for A–G.
- ☐ PASS ☐ FAIL — notes: ___

---

## 26. GO / NO-GO

**Automatic NO-GO** — any single one fails the release:

- [ ] Cross-user data exposure
- [ ] Cross-workspace data exposure
- [ ] RBAC bypass
- [ ] Plan bypass
- [ ] Arbitrary email recipient override
- [ ] Plaintext PIN storage
- [ ] Plaintext PIN logging
- [ ] Raw session token storage
- [ ] Raw session token logging
- [ ] API key leakage
- [ ] SQL / stack trace leakage through MCP
- [ ] Anonymous access to account-specific data
- [ ] Expired/revoked session accepted
- [ ] Voice requirement output differs from the authoritative SmartPR engine for identical facts
- [ ] Grok claims an email was sent when SmartPR did not send it

**Decision**

- Tests passed: ___ / 47 (T-01…T-47)
- Failed test IDs: ___
- Gaps documented (not failures): ___
- **☐ GO — release** / **☐ NO-GO — do not release**
- Sign-off: ___ Date: ___

---

## 27. Known limitations / follow-ups (do not re-verify as failures)

1. **Hangup revocation not wired.** No telephony hangup webhook exists;
   session revocation at call end depends on the gateway calling
   `POST /api/voice/session/revoke`. Wire this when telephony lands.
2. **Call duration tracking pending.** `voice_usage` tracks calls/tool
   calls/emails, not minutes — needs telephony duration callbacks.
3. **No plan gates on Phase 2 tools (by design).** All nine tools work on
   every plan; `email_my_summary` is intentionally free-tier. If paid-only
   voice capabilities are added later, they need their own verification.
4. **xAI `authorization` scheme ambiguity.** xAI docs don't specify whether
   the token is sent as `Bearer <token>` or raw; the server accepts both
   (T-23). Re-check if xAI documents the scheme later.
5. **Session TTL is 30 minutes.** Long calls need a re-auth or refresh flow —
   currently the caller re-authenticates via PIN.
6. **Phase 2 migration must be applied** (`data/voice_phase2_schema.sql`)
   before any production run — `voice_tool_calls` writes are best-effort and
   silently skip until then.
