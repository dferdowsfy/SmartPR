# browser-agent worker — self-hosted Browser Use agent (xAI / Grok)

Runs the open-source `browser-use` agent with **your own xAI model** (default
`grok-4.3`) as the brain, instead of Browser Use Cloud's hosted models.
Browser Use Cloud has no custom-endpoint / xAI-BYOK option, so the only way
to drive the agent with a personal x.ai key is to self-host the runner.

## What it is

A small FastAPI service that mirrors the Cloud v3 session paths SmartPR's
Next.js client already calls (`POST/GET /api/v3/sessions`,
`/stop`, `/messages`), plus:

- `GET /api/v3/sessions/{id}/screenshot?token=` — latest browser frame (PNG)
- `POST /api/v4/runs` `{task, model?, sessionId?, allowedDomains?}` — create a run (new session unless `sessionId` given)
- `GET /api/v4/runs/{id}` — run summary (includes `liveUrl`, `screenshotUrl`, `lastStepSummary`)
- `GET /api/v4/runs/{id}/status` — `{status}` (cheap poll target)
- `POST /api/v4/runs/{id}/cancel` — cancel the run
- `GET /api/v4/runs/{id}/events?after=&limit=` — run events with `nextAfter` cursor
- `POST /api/v4/sessions/{id}/queue` `{text, interrupt?}` — follow-up run on the session
- `GET /api/v4/browsers?agentSessionId=` — Cloud-shaped browser listing with `liveUrl`
- `POST /api/v4/teach` `{startUrl, allowedDomains, recorderScript}` — Teach Clara: open a plain Playwright browser (no agent) with SmartPR's structure-only recorder injected; returns `{sessionId, liveUrl}`
- `GET /api/v4/teach/{id}/events?after=` — recorder events (labels, roles, selectors, page order, value *kind* — never values) with `nextAfter` cursor
- `GET /api/v4/teach/{id}/shots/{seq}` — one step's screenshot (bearer token; SmartPR proxies it to the owner). None is kept for steps on sensitive fields
- `POST /api/v4/teach/{id}/secure-fill` `{value, selector?}` — type a one-time sensitive value (password, SSN, verification code) into the live portal field; never logged, stored or echoed. Works for teach and replay (drive) sessions
- `POST /api/v4/teach/{id}/stop` — close the teach browser
- `GET /api/v4/capabilities` (bearer) — what SmartPR's Teach Clara probe checks: `teach`, `drive`, `secureFill`, `protocol`, `browser` (a headed Chromium actually launched on the display), `liveView`, `busy`
- `GET /vnc/vnc.html?token=` — token-gated live viewer (noVNC, interactive)
- `WS /vnc/websock?token=` — bridges the viewer to the session's browser

The browser is a headed Chromium under Xvfb, exported via x11vnc. The viewer
token is per-session and only handed to the run owner through SmartPR's
owner-gated API — the same privacy posture as the Cloud viewer.

## Deploy (Railway)

1. New service from this repo, root directory `workers/browser-agent`
   (Dockerfile build).
2. Environment variables:

   | Var | Value |
   |---|---|
   | `XAI_API_KEY` | your x.ai API key |
   | `XAI_MODEL` | `grok-4.3` (exact xAI model id; adjust if xAI names it differently) |
   | `WORKER_API_TOKEN` | long random string (shared secret with the Next.js app) |
   | `PUBLIC_WORKER_URL` | the service's public URL, e.g. `https://browser-agent.up.railway.app` |
   | `TASK_TIMEOUT_MIN` | `20` (optional) |

3. In the Next.js (SmartBusiness) service set:

   | Var | Value |
   |---|---|
   | `AGENT_PROVIDER` | `self_hosted` |
   | `SELF_HOSTED_AGENT_URL` | same public URL (client appends `/api/v4`), e.g. `https://browser-agent.up.railway.app` |
   | `WORKER_API_TOKEN` | same secret as above |
   | `XAI_MODEL` | `grok-4.3` (optional; overrides per deploy) |

   Omit `AGENT_PROVIDER` (or set `browser_use_cloud`) to keep using Browser
   Use Cloud with `BROWSER_USE_MODEL` (default `gpt-5.6-luna`).

   Teach Clara and "Fill with Clara" replays always need this worker
   (`SELF_HOSTED_AGENT_URL` + `WORKER_API_TOKEN`), whatever `AGENT_PROVIDER`
   says — Browser Use Cloud can't inject the recorder.

## Teach Clara sessions

Teach mode lets a person walk a filing once in the live viewer while the
recorder notes the screens (see `frontend/src/lib/agency-runs/teach/`). The
person signs in themselves; the worker never types anything. Top-level
navigation outside `allowedDomains` is blocked. Only whitelisted event keys
are queued, and SmartPR's server sanitizes every event again.

| Var | Value |
|---|---|
| `TEACH_TIMEOUT_MIN` | `45` (optional) — maximum length of a teach session; the browser closes after it |
| `CHROMIUM_PATH` | optional — a specific Chromium build for Playwright |
| `TEACH_IGNORE_HTTPS_ERRORS` | development only (local self-signed fixtures); never set in production |

Sensitive fields (passwords, SSNs, one-time codes, card numbers) are
detected in the page and masked on screen (live view and screenshots show
dots); the recorder reports them as "secret" without reading them. A person
can type such a value into Clara's masked one-time card instead of the live
view; SmartPR sends it once to `secure-fill` and keeps nothing.

**Is it working?** SmartPR probes the worker before every teach session
(`GET /healthz`, then `GET /api/v4/capabilities` with the token) and shows a
specific reason when it can't record: not configured, unreachable, token
mismatch, outdated worker, Chromium can't launch on the display (e.g. Xvfb
not running), or live view not wired (`PUBLIC_WORKER_URL`, noVNC). Admins
also see the operator hint in the Teach Clara chat.

On the Next.js side, `TEACH_APPROVED_DOMAINS` (comma-separated hosts) lists
non-government sites anyone may teach on; government domains are always
allowed, and admins may teach on any HTTPS site.

## Pilot constraints

- **One active session at a time.** The display is shared; a second `POST
  /api/v3/sessions` while one runs returns `409`. Stop the first run first.
- **Task timeout** (`TASK_TIMEOUT_MIN`, default 20 min) marks the session
  `timed_out`.
- **No cloud proxy** — the worker's own egress IP is used. If a portal
  blocks datacenter IPs, keep `AGENT_PROVIDER=browser_use_cloud` for that run.
- **Grok is unvalidated for browser-use.** The wiring is OpenAI-compatible
  and will run, but agentic reliability on real portals has not been
  measured. Keep the Cloud path as fallback and A/B on rehearsals before
  trusting it with real filings.

## Local dev

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
XAI_API_KEY=... WORKER_API_TOKEN=dev PUBLIC_WORKER_URL=http://localhost:8000 \
  BROWSER_USE_VISION=false uvicorn app:app --port 8000
```

Local runs still need Xvfb + x11vnc for the live viewer; without them the
agent runs headless-less and screenshots still work via the poller.
(`BROWSER_USE_VISION=false` saves tokens while iterating.)
