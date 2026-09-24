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
| **Browser Use Cloud** (default) | `BROWSER_USE_API_KEY` is set | Server creates a v4 **run** via the official `browser-use-sdk` (`POST https://api.browser-use.com/api/v4/runs`) with a filing task prompt + Business Passport JSON, default model `gpt-5.6-luna` (cheapest), `reasoning.effort: low`, US proxy, and a `$5` per-run cost cap. Stores `browser_use_run_id` + `browser_use_session_id`; live view URL comes from `GET /api/v4/browsers?agentSessionId=`. UI embeds `live_url` in an iframe. Poll syncs run status + run events into `agency_run_events`. Resume queues a follow-up run on the same session. Stop cancels the run and stops the browser (ends Cloud billing). |
| **Self-hosted agent** | `AGENT_PROVIDER=self_hosted` + `SELF_HOSTED_AGENT_URL` + `WORKER_API_TOKEN` | Same v4 run/session paths, served by `workers/browser-agent` (FastAPI + OSS `browser-use` on your own xAI model, default `grok-4.3`). Live view is a token-gated noVNC session; domain allowlist is enforced by browser-use itself via `allowedDomains`. Pilot: one active session at a time. |
| **Mock** (fallback) | env unset | In-memory timeline advances on GET poll with SVG placeholder screenshots — no real automation. |

### Env vars
| Variable | Required | Notes |
|----------|----------|-------|
| `BROWSER_USE_API_KEY` | for live Cloud worker | Server-only. **Never** prefix with `NEXT_PUBLIC_`. Do not log the value. |
| `BROWSER_USE_MODEL` | optional | Cloud default `gpt-5.6-luna` (cheapest per 2026-09 research). |
| `AGENT_PROVIDER` | optional | `self_hosted` to use the worker; anything else (or unset) = Browser Use Cloud. |
| `SELF_HOSTED_AGENT_URL` | for self-hosted | Worker public URL (the client appends `/api/v4`), e.g. `https://browser-agent.up.railway.app`. |
| `WORKER_API_TOKEN` | for self-hosted | Shared secret between Next.js and the worker. Server-only. |
| `XAI_MODEL` | optional | Self-hosted default `grok-4.3` (exact xAI model id). |

Set `BROWSER_USE_API_KEY` on Railway (or local `.env`) and redeploy. Without it, the UI still works in mock mode.

### Security
- API key is read only in Node route handlers / `lib/agency-runs/browserUseClient.ts`.
- `live_url` is session-scoped (treat as a credential). Returned only to the authenticated owner when `owner_user_id` was recorded at create time.
- CSP on `/businesses/:id/agency-run` allows `frame-src` for `https://live.browser-use.com` (and `*.browser-use.com`).
- Agent prompt: never click final submit until the owner authorizes it ("File it for me" with an attestation); pause at upload/login/captcha walls.

## Persistence note
Runs live in a **process-local `Map`** (`frontend/src/lib/agency-runs/store.ts`, keyed by run id). Fine for demos; replace with `agency_runs` / `agency_run_events` tables in a follow-up.

## Demo (with Browser Use on Railway)
1. Set Railway env `BROWSER_USE_API_KEY=bu_…` → redeploy frontend
2. Open a business profile → **File with agency assistant** → **Open assistant**
3. Start **Register Taxpayer** — right panel should show the live Browser Use iframe within a few seconds
4. Watch the step log sync from Cloud messages / step summaries
5. When the agent pauses for upload or login, use the overlay (Evidence Locker upload optional) → **Resume**
6. At **Review**, check the attestation and hit **File it for me** — SmartPR submits the filing on the portal on your behalf (or take over the browser to file yourself)
7. **Stop** cancels/ends the Browser Use session

## Demo (mock fallback)
1. Ensure `BROWSER_USE_API_KEY` is **unset**
2. Start a run; mock steps + placeholders advance on ~1s polls
3. Resume through upload → login → review
