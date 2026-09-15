# Agency Run UI (SURI assisted filing)

## What shipped
- Business profile card **File with agency assistant** → `/businesses/[id]/agency-run`
- Preflight (filing type, hard rules, gotcha hints) + live run panel (step log, screenshot / live iframe, filmstrip, status pill)
- Pause overlays for `USER_UPLOAD` | `USER_LOGIN` | `CAPTCHA` with Resume / Stop
- Upload pause hooks into existing `/api/evidence` Evidence Locker (tags `DOC_PHOTO_ID`, `DOC_UTILITY_BILL`, `DOC_SSN_CARD`) and enforces **5 MB** client-side for SURI
- Review state: last screenshot / live view + “You submit on the portal”
- API: `POST /api/agency-runs`, `GET /api/agency-runs/[id]`, `POST .../resume`, `POST .../stop`

## Workers
| Mode | When | Behavior |
|------|------|----------|
| **Browser Use Cloud** | `BROWSER_USE_API_KEY` is set | Server creates a v3 session (`POST https://api.browser-use.com/api/v3/sessions`) with a SURI task prompt + Business Passport JSON. Stores `browser_use_session_id` + `live_url`. UI embeds `live_url` in an iframe. Poll syncs status/messages into `agency_run_events`. Stop ends the Cloud session. |
| **Mock** (fallback) | env unset | In-memory timeline advances on GET poll with SVG placeholder screenshots — no real automation. |

### Env vars
| Variable | Required | Notes |
|----------|----------|-------|
| `BROWSER_USE_API_KEY` | for live Cloud worker | Server-only. **Never** prefix with `NEXT_PUBLIC_`. Do not log the value. |
| `BROWSER_USE_MODEL` | optional | Defaults to `bu-mini`. |

Set `BROWSER_USE_API_KEY` on Railway (or local `.env`) and redeploy. Without it, the UI still works in mock mode.

### Security
- API key is read only in Node route handlers / `lib/agency-runs/browserUseClient.ts`.
- `live_url` is session-scoped (treat as a credential). Returned only to the authenticated owner when `owner_user_id` was recorded at create time.
- CSP on `/businesses/:id/agency-run` allows `frame-src` for `https://live.browser-use.com` (and `*.browser-use.com`).
- Agent prompt: never click final SURI submit; pause at upload/login/captcha walls.

## Persistence note
Runs live in a **process-local `Map`** (`frontend/src/lib/agency-runs/store.ts`, keyed by run id). Fine for demos; replace with `agency_runs` / `agency_run_events` tables in a follow-up.

## Demo (with Browser Use on Railway)
1. Set Railway env `BROWSER_USE_API_KEY=bu_…` → redeploy frontend
2. Open a business profile → **File with agency assistant** → **Open assistant**
3. Start **Register Taxpayer** — right panel should show the live Browser Use iframe within a few seconds
4. Watch the step log sync from Cloud messages / step summaries
5. When the agent pauses for upload or login, use the overlay (Evidence Locker upload optional) → **Resume**
6. At **Review**, submit yourself on SURI — the agent never clicks final submit
7. **Stop** cancels/ends the Browser Use session

## Demo (mock fallback)
1. Ensure `BROWSER_USE_API_KEY` is **unset**
2. Start a run; mock steps + placeholders advance on ~1s polls
3. Resume through upload → login → review
