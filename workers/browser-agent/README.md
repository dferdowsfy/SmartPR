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
