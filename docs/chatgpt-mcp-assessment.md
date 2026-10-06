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
| MCP Apps UI resource `ui://smartpr/requirements-v7.html` (canonical; `resources/read` also serves v1–v6 aliases) | `frontend/src/lib/chatgpt/widget.ts` (+ inlined Leaflet `vendor/leaflet.generated.ts`) |
| Tile proxy `/api/tiles/{z}/{x}/{y}.png` (PR-only, Esri upstream) | `frontend/src/app/api/tiles/[z]/[x]/[y]/route.ts`, `frontend/src/lib/chatgpt/tiles.ts` |
| Pin site details (street, zoning/FEMA/landslide/coastal chips) | `frontend/src/lib/chatgpt/siteLookup.ts` |
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

### Site map pin (widget v7 — `ui://smartpr/requirements-v7.html`)
- **Why v7, not v6:** an interim SVG-only "v6" (empty CSP) was live in production for a short time. ChatGPT caches a template and its CSP per URI, so the tile-enabled widget ships under a URI ChatGPT has never fetched. v1–v6 remain aliases.
- **Basemap:** Leaflet 1.9.4 is **inlined** in the widget HTML (`lib/chatgpt/vendor/leaflet.generated.ts`, built by `frontend/scripts/build-chatgpt-leaflet.mjs <leaflet package dir>`; no external script/stylesheet). It draws raster `<img>` tiles from SmartPR's own tile proxy, `https://www.getsmartpr.com/api/tiles/{z}/{x}/{y}.png` (streets) and `…png?s=sat` (satellite toggle). The proxy (`src/app/api/tiles/[z]/[x]/[y]/route.ts`, helpers `lib/chatgpt/tiles.ts`) serves Esri World_Street_Map and World_Imagery (the portal intake already uses Esri World_Imagery for its satellite view) for Puerto Rico only (z7–z19 inside the PR envelope), with a per-IP rate limit (`CHATGPT_TILE_RATE_PER_MIN`, default 1200), a 6 s upstream timeout, an in-memory LRU and `Cache-Control: public, max-age=86400, s-maxage=604800`. The `.png` suffix keeps it out of the auth middleware. Esri attribution is shown on the map. You can swap the upstream with `CHATGPT_TILE_URL_STREETS` / `CHATGPT_TILE_URL_SATELLITE` (`{z}/{x}/{y}` template; a keyed provider's key stays server-side). We did not use tile.openstreetmap.org (the OSMF tile policy forbids proxying it as an app basemap), Carto basemaps (the free tier is non-commercial), or the portal's OpenFreeMap vector style (vector tiles need `fetch`, see below).
- **CSP:** only the portal origin is declared, in every form ChatGPT reads: `_meta.ui.csp {connectDomains:[portal], resourceDomains:[portal]}`, `_meta.ui.domain` and `openai/widgetDomain` = portal, `openai/widgetCSP {connect_domains, resource_domains, redirect_domains}` = `[portal]`. `resources/list` entries carry the same `_meta`. Per the Apps SDK reference, `resourceDomains` covers static assets (images, fonts, scripts, styles), so tile `<img>` loads fall under `img-src`. The design does not rely on `connect_domains`: openai/openai-apps-sdk-examples issue #85 reports ChatGPT not honouring `connect_domains` for fetch/XHR while `resource_domains` works, which rules out MapLibre/vector tiles. The widget makes no fetch/XHR; all data goes through `tools/call` on the MCP Apps bridge (or `window.openai.callTool`).
- **Fallback:** if no tile loads within 3 s (`TILE_TIMEOUT_MS`), or 6 tile errors occur, the map switches in place to the municipio outline map (Leaflet polygons from `prMapShapes.ts`, Census CB 2024). If Leaflet itself fails, an inline-SVG map with tap, drag and ± zoom takes over. Either way the card never breaks, and the pin still taps, drags and refines.
- **Pin behaviour:**
  - If the scenario names a municipality but has no site, `assess_scenario` returns `approximate_site` (the municipio's downtown via `municipioFocus`) and the widget drops an amber "≈ approximate" pin there immediately.
  - The pin is draggable with mouse and touch. On drag end, `refine_scenario({scenario, site:{latitude, longitude}, answers: <unsent dropdowns>})` runs. Tapping the map places or moves the pin and does the same. The pin shows at once and reverts only if the call fails or the point is outside PR.
  - The server re-resolves every pin (`locateInPuertoRico`, TIGER 2024). The pin is authoritative for the municipality and is flagged when it falls within 25 m of a boundary.
- **Location panel** (mirrors the portal Project location card):
  - Status pill: Location confirmed / Approximate location / Checking. Rows: place, Municipality, Barrio, Street, Parcel, Coordinates. Then chips for Zoning / FEMA flood / Landslide / Coastal zone, and "View full property report", which creates a `continue` handoff carrying the pin.
  - Chips and street come from `site_details` on `refine_scenario` (`lib/chatgpt/siteLookup.ts`). It reuses the portal's `resolveSiteLayers` (JP calificación, FEMA NFHL, terrain, coastal zone, CRIM parcel; optional layers skipped, nothing stored) plus the configured reverse geocoder.
  - Lookups wait up to 3 s. Past that the result is `pending:true`, and the widget re-polls refine up to 3× while the server finishes (8 s budget, cached per point for 10 min).
  - A layer that doesn't resolve shows "See full report"; values are never invented. Set `CHATGPT_SITE_LOOKUPS=false` to disable lookups (then `site_details: null`).
- **State model (root cause of "tap doesn't stick", fixed in v7):** v5 re-applied the ORIGINAL `window.openai.toolOutput` on every `openai:set_globals` event. ChatGPT fires that event for any global (maxHeight, theme, displayMode, safe area, widgetState), and the pin row itself changed the height. As a result, every tap or dropdown choice was wiped within ~150 ms, and Unlock then sent `site:null, answers:{}` (the "Not pinned / Not provided" review page). The current widget fixes this as follows:
  - Results are forward-only: a result is accepted only if its `versions.generated_at` is newer, or it is the reply to the widget's own call.
  - The pin and dropdown drafts are never reset by host events.
  - State is persisted with `window.openai.setWidgetState({v:6, scenario, pin, answers})` (state schema version 6) and restored on remount.
  - Unlock / Use my plan / Continue send the current scenario plus unsent answers. `create_portal_handoff` accepts optional `answers`/`site` and returns `carried {site, answers, business_status, renovation}`.
- **Cached template_pointer:** `WIDGET_URI_ALIASES` makes `resources/list`/`resources/read` serve the **current** HTML and CSP for v1–v7. `tools/list` advertises v7 only. After a bump, refresh the connector and start a new chat.
- **Requirements list:** free-preview groups render expanded so ≥5 items are visible when the engine returns them.

#### ChatGPT-like harness + smoke
- Start the harness with `cd frontend && npx tsx scripts/chatgpt-harness/server.mts` and open http://localhost:4100. Set `LOOKUPS=0` to skip real layer lookups.
  - It renders the widget in a sandboxed `srcdoc` iframe (opaque origin) with a meta CSP built from the declared `_meta` (`?block=tiles` drops the resource domains).
  - It provides the MCP Apps bridge (`ui/initialize`, tool-input/result, `tools/call`, `ui/open-link`) and a `window.openai` shim (callTool, setWidgetState, notifyIntrinsicHeight).
  - It emulates ChatGPT re-publishing globals on resize and widgetState changes. `window.poke()` and `window.remount()` are available.
- Run `node scripts/chatgpt-harness/smoke.mjs /workspace/shots` for a headless Chrome check at 760 px (mouse) and 375 px (touch). It checks:
  - tiles load and the approximate auto-pin appears; a globals storm doesn't wipe anything;
  - drag → refine(site), chips arrive, and the confirmed panel shows; tap moves the pin;
  - answers survive and the handoff token carries answers and site; remount restores state;
  - with no location, tap and drag work; the fallback kicks in when tiles are blocked.
  - Screenshots are saved as `chatgpt-v6-*.png`.

### Handoff (review-before-save)
1. Widget/model calls `create_portal_handoff` (intent `unlock` | `use_plan` | `continue`) → `https://www.getsmartpr.com/chatgpt/handoff?t=<token>`. The widget's Unlock / Use my plan / Continue buttons open exactly the `structuredContent.url` the server returned (no host in the widget). The portal origin comes from `lib/chatgpt/portalUrl.ts`: runtime `CHATGPT_PORTAL_URL` → the request's own `*.getsmartpr.com` host → `NEXT_PUBLIC_SITE_URL` if https/public/not a tunnel → `https://www.getsmartpr.com`. It never emits localhost (unless explicitly overridden for a local-only request) and never the dev tunnel (ngrok, loca.lt, trycloudflare). `NEXT_PUBLIC_SITE_URL` is inlined at **build** time, so exporting it only for `next start` has no effect — use `CHATGPT_PORTAL_URL` at runtime.
   - **The portal that opens the link verifies the token**, so it must share `CHATGPT_HANDOFF_SECRET` with the server that signed it (local dev server behind ngrok → production www needs the same secret).
2. Token = base64url(JSON payload) + HMAC-SHA256 (`CHATGPT_HANDOFF_SECRET`), 6 h TTL, contains only the normalized scenario + intent (no email, account, ChatGPT ids). Fails closed if the secret is missing/short.
3. Landing page verifies server-side and shows the facts, including the map pin and every clarifying answer as question → answer (`describeAnswers`, server-side). Nothing is created. "Review in SmartPR intake" writes the existing guest draft (`lib/guestDraft.ts`) and opens `/?entry=new-business&source=chatgpt`, where the intake restores it for guests and signed-in users and the user confirms every step. No business, passport or filing is auto-created.
4. Sign-in survival: "Sign in to use my plan" / "Sign in or create an account" use `/auth/login?next=/chatgpt/handoff?t=…` (signup and email verification carry the same `next`); the token is stateless so it remains valid after the round trip until expiry. Signed-in users see "Continue with my SmartPR plan" / "Continue to full assessment" instead of the sign-in button.

### Data flow: ChatGPT vs SmartPR
- **ChatGPT → SmartPR:** only tool arguments (business activity, municipality, size, employees, renovation scope, clarifying answers). Users should not put personal data in scenarios; the schema has no name/email/address fields.
- **SmartPR → ChatGPT:** the free-preview assessment (public regulatory information + the echoed scenario). No account data.
- **SmartPR stores:** nothing for MCP calls (no DB access; only the in-memory per-IP rate-limit bucket). Server logs record failures only (no arguments).
- **Handoff:** scenario travels inside the signed URL to the portal; persisted only if the user proceeds and saves in the portal under its existing data-retention policy (`docs/security/data-retention.md`).
- OpenAI processes the conversation under its own terms; SmartPR does not receive the chat transcript.

### Abuse controls
Per-IP rate limit (`CHATGPT_MCP_RATE_PER_MIN`, default 60/min, `lib/rateLimit.ts` — per instance, in-memory), 64 KB body cap, 20 KB argument cap, batch requests rejected, unknown tools/answers rejected or dropped, kill switch `CHATGPT_MCP_ENABLED=false`. The widget has no external scripts or fonts and makes no fetch/XHR. Its only remote loads are tile images from the portal origin (the sole CSP entry), and it renders tool data via `textContent` only. The tile proxy is rate limited per IP (`CHATGPT_TILE_RATE_PER_MIN`) and restricted to Puerto Rico tiles. ChatGPT calls come from shared OpenAI egress IPs, so if many users hit the 60/min MCP limit, raise `CHATGPT_MCP_RATE_PER_MIN`.

## Run locally
```bash
cd frontend
cp .env.example .env.local   # then add:
# CHATGPT_HANDOFF_SECRET=<random 32+ chars>   e.g. openssl rand -base64 48
# CHATGPT_PORTAL_URL=https://www.getsmartpr.com  (optional; handoff link origin, runtime. Default www.getsmartpr.com.
#                                                http://localhost:3000 only works for local-only requests)
# CHATGPT_MCP_RATE_PER_MIN=60                  (optional)
# CHATGPT_MCP_ENABLED=true                     (optional kill switch)
# CHATGPT_SITE_LOOKUPS=false                   (optional; disables pin site chips/street lookups)
# CHATGPT_TILE_RATE_PER_MIN=1200               (optional; tile proxy per-IP limit)
# CHATGPT_TILE_URL_STREETS / CHATGPT_TILE_URL_SATELLITE  (optional upstream {z}/{x}/{y} templates; default Esri)
npm run dev
npm run test:chatgpt
```
Smoke test:
```bash
curl -s localhost:3000/api/mcp/chatgpt -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"assess_scenario","arguments":{"business_type":"manufacturing","municipality":"Guaynabo","square_feet":12000,"employees":28,"renovation":"interior"}}}'
```

## MCP Inspector
`npx @modelcontextprotocol/inspector` → Transport **Streamable HTTP** → URL `http://localhost:3000/api/mcp/chatgpt`. Verify initialize + instructions, the 3 tools and annotations, `resources/read ui://smartpr/requirements-v7.html`, and call each tool with valid and invalid input (unknown tool → -32602; bad answers → `dropped_answers`).

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
- Product: in-widget address search (needs a geocoder reachable without `connect-src`, e.g. a server-side `search_location` tool) and in-widget zoning/flood overlays (could be proxied through the same portal origin as the tiles).
