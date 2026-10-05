# SmartPR in ChatGPT — MCP Apps assessment (v0.1, developer mode)

Scope of this milestone: **prompt → preliminary requirements → clarification → updated assessment → portal handoff**.
No interactive map (that is the later `mockup-location` milestone). Not deployed to production, not submitted for public listing.

## What it is

| Piece | Path |
| --- | --- |
| MCP endpoint (Streamable HTTP, stateless JSON-RPC) | `frontend/src/app/api/mcp/chatgpt/route.ts` → `POST /api/mcp/chatgpt` |
| JSON-RPC handler, tool + resource registry | `frontend/src/lib/chatgpt/mcp.ts` |
| Engine adapter (same engine as portal intake) | `frontend/src/lib/chatgpt/assessment.ts` |
| Signed expiring handoff tokens | `frontend/src/lib/chatgpt/handoff.ts` |
| MCP Apps UI resource `ui://smartpr/requirements-v1.html` | `frontend/src/lib/chatgpt/widget.ts` |
| Portal review-before-save landing | `frontend/src/app/chatgpt/handoff/` → `/chatgpt/handoff?t=…` |
| Tests | `frontend/src/lib/chatgpt/chatgpt.test.ts` (`npm run test:chatgpt`) |

Pattern mirrors the voice MCP server (`docs/voice-mcp.md`, `lib/voice/mcp.ts`): hand-rolled, stateless JSON-RPC 2.0, curated tools only, no SQL/DB/filesystem/admin access.

### Tools

| Tool | Annotations | UI | Purpose |
| --- | --- | --- | --- |
| `assess_scenario` | readOnly, not destructive, closed world | `_meta.ui.resourceUri` (+ `openai/outputTemplate` alias) | Facts the user stated → preliminary requirements + clarifying questions |
| `refine_scenario` | readOnly | same widget | Previous `scenario` + `answers` → updated assessment. Prior answers are preserved (merge, new answers win; `"unknown"` clears) |
| `create_portal_handoff` | readOnly (no server state) | — (widget-callable) | Returns a 6-hour signed link to `/chatgpt/handoff` |

Engine: `runRulesEngine` + `classifyEngineRequirements` over `puertoRicoPack.kb` — identical to the portal intake and the voice `get_general_requirements` tool. ChatGPT only extracts facts into the input schema; requirements never come from model knowledge.

Structured output (`structuredContent`): `status` (complete | partial | unsupported), normalized `scenario`, `assumptions`, `unresolved_facts`, `clarifying_questions`, `requirements[]` (`agency`, `group`, `applicability` supported | conditional | unresolved, `why`, `evidence` (engine trigger facts/rules), `dependencies`, `next_steps`, `citations` (KB rule/document citations only — never generated), `official_source_url`), `gated`, `counts`, `coverage_limits`, `versions` (`generated_at`, server, engine, `kb` content hash, rule count). No readiness percentage.

Unknown facts are never a silent "no": unanswered high-signal KB questions surface their documents as `unresolved` with the question as a dependency; answering moves them into normal engine evaluation (or removes them on "no").

### Free preview vs paid (server-side gating)
The endpoint is anonymous and returns at most `FREE_PREVIEW_LIMIT` (8) requirements; the remainder is only counted (`gated.hidden_requirement_count`). Full list, cross-agency sequencing, report download and evidence tracking are not exposed by this server at all — they stay in the authenticated portal. No prices are shown anywhere; "Unlock" routes to the portal (`/pricing`, existing page).

### Handoff (review-before-save)
1. Widget/model calls `create_portal_handoff` (intent `unlock` | `use_plan` | `continue`) → `https://www.getsmartpr.com/chatgpt/handoff?t=<token>`. The widget's Unlock / Use my plan / Continue buttons open exactly the `structuredContent.url` the server returned (no host in the widget). The portal origin comes from `lib/chatgpt/portalUrl.ts`: runtime `CHATGPT_PORTAL_URL` → the request's own `*.getsmartpr.com` host → `NEXT_PUBLIC_SITE_URL` if https/public/not a tunnel → `https://www.getsmartpr.com`. It never emits localhost (unless explicitly overridden for a local-only request) and never the dev tunnel (ngrok, loca.lt, trycloudflare). `NEXT_PUBLIC_SITE_URL` is inlined at **build** time, so exporting it only for `next start` has no effect — use `CHATGPT_PORTAL_URL` at runtime.
   - **The portal that opens the link verifies the token**, so it must share `CHATGPT_HANDOFF_SECRET` with the server that signed it (local dev server behind ngrok → production www needs the same secret).
2. Token = base64url(JSON payload) + HMAC-SHA256 (`CHATGPT_HANDOFF_SECRET`), 6 h TTL, contains only the normalized scenario + intent (no email, account, ChatGPT ids). Fails closed if the secret is missing/short.
3. Landing page verifies server-side and shows the facts. Nothing is created. "Review in SmartPR intake" writes the existing guest draft (`lib/guestDraft.ts`) and opens `/?entry=new-business&source=chatgpt`, where the intake restores it for guests and signed-in users and the user confirms every step. No business, passport or filing is auto-created.
4. Sign-in survival: "Sign in to use my plan" / "Sign in or create an account" use `/auth/login?next=/chatgpt/handoff?t=…` (signup and email verification carry the same `next`); the token is stateless so it remains valid after the round trip until expiry. Signed-in users see "Continue with my SmartPR plan" / "Continue to full assessment" instead of the sign-in button.

### Data flow: ChatGPT vs SmartPR
- **ChatGPT → SmartPR:** only tool arguments (business activity, municipality, size, employees, renovation scope, clarifying answers). Users should not put personal data in scenarios; the schema has no name/email/address fields.
- **SmartPR → ChatGPT:** the free-preview assessment (public regulatory information + the echoed scenario). No account data.
- **SmartPR stores:** nothing for MCP calls (no DB access; only the in-memory per-IP rate-limit bucket). Server logs record failures only (no arguments).
- **Handoff:** scenario travels inside the signed URL to the portal; persisted only if the user proceeds and saves in the portal under its existing data-retention policy (`docs/security/data-retention.md`).
- OpenAI processes the conversation under its own terms; SmartPR does not receive the chat transcript.

### Abuse controls
Per-IP rate limit (`CHATGPT_MCP_RATE_PER_MIN`, default 60/min, `lib/rateLimit.ts` — per instance, in-memory), 64 KB body cap, 20 KB argument cap, batch requests rejected, unknown tools/answers rejected or dropped, kill switch `CHATGPT_MCP_ENABLED=false`. Widget has no external scripts/fonts/network (empty CSP allowlists) and renders tool data via `textContent` only.

## Run locally
```bash
cd frontend
cp .env.example .env.local   # then add:
# CHATGPT_HANDOFF_SECRET=<random 32+ chars>   e.g. openssl rand -base64 48
# CHATGPT_PORTAL_URL=https://www.getsmartpr.com  (optional; handoff link origin, runtime. Default www.getsmartpr.com.
#                                                http://localhost:3000 only works for local-only requests)
# CHATGPT_MCP_RATE_PER_MIN=60                  (optional)
# CHATGPT_MCP_ENABLED=true                     (optional kill switch)
npm run dev
npm run test:chatgpt
```
Smoke test:
```bash
curl -s localhost:3000/api/mcp/chatgpt -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"assess_scenario","arguments":{"business_type":"manufacturing","municipality":"Guaynabo","square_feet":12000,"employees":28,"renovation":"interior"}}}'
```

## MCP Inspector
`npx @modelcontextprotocol/inspector` → Transport **Streamable HTTP** → URL `http://localhost:3000/api/mcp/chatgpt`. Verify initialize + instructions, the 3 tools and annotations, `resources/read ui://smartpr/requirements-v1.html`, and call each tool with valid and invalid input (unknown tool → -32602; bad answers → `dropped_answers`).

## Connect in ChatGPT (developer mode)
1. Expose the local server over HTTPS (e.g. `ngrok http 3000` or a Secure MCP Tunnel) or use a preview deployment; handoff links still point at `https://www.getsmartpr.com` (never the tunnel), so production must have the same `CHATGPT_HANDOFF_SECRET` as the local server. To test the handoff page against the local server instead, set `CHATGPT_PORTAL_URL=https://<tunnel-host>` explicitly.
2. ChatGPT → Settings → Apps & Connectors → Advanced → enable **Developer mode**.
3. Create a connector/app: MCP server URL `https://<host>/api/mcp/chatgpt`, authentication **None** (anonymous preview).
4. In a new chat, enable the app and try: "I want to open a manufacturing business in a 12,000 sq ft warehouse in Guaynabo, with 28 employees and interior renovations. What do I need?"
5. Answer the widget's questions → "Update preview" → "Continue in SmartPR". After changing tool metadata, refresh the connector.

> Status: verified with unit tests, the live dev-server HTTP endpoint, and a local MCP Apps host harness (`ui/initialize`, tool-input/result, `tools/call`, `ui/open-link`). **Not yet observed inside live ChatGPT.**

## Remaining blockers before public submission
- Stable public HTTPS endpoint + domain verification (no production deploy in this milestone).
- OAuth 2.1 (authorization server metadata, `WWW-Authenticate` challenge) for paid/full assessments and "Use my SmartPR plan" inside ChatGPT; today paid content is simply not exposed.
- Distributed rate limiting (Redis/edge) — current limiter is per instance.
- Live ChatGPT developer-mode QA (render, `ui/open-link`, follow-ups) and the evaluation prompt set (direct / indirect / out-of-scope).
- Publisher items: privacy policy + terms URLs covering ChatGPT data flow, app icon/screenshots, support contact, CSP review justification, legal review of "not legal advice" copy, Spanish localization of the widget.
- Product: interactive site map milestone (`mockup-location`).
