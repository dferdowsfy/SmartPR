"""
Self-hosted Browser Use agent worker — Grok / xAI edition.

Runs the open-source `browser-use` agent with the operator's own xAI model
(default grok-4.3) as the brain, on a headed Chromium under Xvfb. It mirrors
the subset of the Browser Use Cloud v3 session API that SmartPR's Next.js
client uses, so switching providers is an env change, not a rewrite:

  POST   /api/v3/sessions                  {task, keepAlive, model, sessionId?}
  GET    /api/v3/sessions/{id}
  POST   /api/v3/sessions/{id}/stop        {strategy: "session" | "task"}
  GET    /api/v3/sessions/{id}/messages    ?after=&pageSize=
  GET    /api/v3/sessions/{id}/screenshot  ?token=      (latest PNG, token-gated)
  GET    /vnc/vnc.html?token=              custom noVNC viewer (token-gated)
  WS     /vnc/websock?token=               browser websocket <-> x11vnc bridge

Live view: Chromium renders on Xvfb :99, x11vnc exports it on 127.0.0.1:5900,
and the /vnc/websock endpoint bridges the noVNC client straight to x11vnc.
Each session gets its own random viewer token; the token is only ever handed
to the run owner through SmartPR's owner-gated API.

Pilot constraints (documented, not hidden):
  - ONE active session at a time (shared display). A second create while one
    runs returns 409.
  - Task timeout caps a run (TASK_TIMEOUT_MIN, default 20).
  - No cloud proxy — the worker's own egress IP is used.

Env:
  XAI_API_KEY         required — xAI API key (never logged, never returned)
  XAI_MODEL           default "grok-4.3" — exact xAI model id
  WORKER_API_TOKEN    required — bearer token SmartPR's server presents
  PUBLIC_WORKER_URL   required — e.g. https://browser-agent.up.railway.app
  TASK_TIMEOUT_MIN    default 20
  BROWSER_USE_VISION  default "true"
  NOVNC_DIR           default "/usr/share/novnc"
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

log = logging.getLogger("browser-agent")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

XAI_API_KEY = os.environ.get("XAI_API_KEY", "").strip()
XAI_MODEL = os.environ.get("XAI_MODEL", "").strip() or "grok-4.3"
WORKER_API_TOKEN = os.environ.get("WORKER_API_TOKEN", "").strip()
PUBLIC_WORKER_URL = os.environ.get("PUBLIC_WORKER_URL", "").strip().rstrip("/")
TASK_TIMEOUT_MIN = float(os.environ.get("TASK_TIMEOUT_MIN", "20") or 20)
USE_VISION = (os.environ.get("BROWSER_USE_VISION", "true") or "true").lower() not in ("0", "false", "no")
NOVNC_DIR = os.environ.get("NOVNC_DIR", "/usr/share/novnc")
XAI_BASE_URL = "https://api.x.ai/v1"

if not XAI_API_KEY:
    log.warning("XAI_API_KEY is not set — session creation will fail until it is.")
if not WORKER_API_TOKEN:
    log.warning("WORKER_API_TOKEN is not set — all API calls will be rejected.")
if not PUBLIC_WORKER_URL:
    log.warning("PUBLIC_WORKER_URL is not set — liveUrl/screenshotUrl will be relative.")


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #

async def require_api_token(authorization: Optional[str] = Header(default=None)):
    if not WORKER_API_TOKEN or authorization != f"Bearer {WORKER_API_TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


# --------------------------------------------------------------------------- #
# Session state
# --------------------------------------------------------------------------- #

@dataclass
class SessionLog:
    id: str
    role: str
    text: str
    created_at: str


@dataclass
class AgentSession:
    id: str
    token: str  # viewer token — owner-only, in liveUrl/screenshotUrl
    model: str
    status: str = "created"  # created|running|idle|stopped|timed_out|error
    title: str = ""
    browser: Any = None
    agent: Any = None
    run_task: Optional[asyncio.Task] = None
    last_summary: str = ""
    output: Any = None
    is_task_successful: Optional[bool] = None
    step_count: int = 0
    shot: Optional[bytes] = None
    shot_at: float = 0.0
    created_at: float = field(default_factory=time.time)
    log_entries: list[SessionLog] = field(default_factory=list)
    stop_requested: bool = False

    def push_log(self, role: str, text: str) -> SessionLog:
        entry = SessionLog(
            id=f"msg_{uuid.uuid4().hex[:12]}",
            role=role,
            text=text[:2000],
            created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        self.log_entries.append(entry)
        return entry


SESSIONS: dict[str, AgentSession] = {}


def session_by_token(token: Optional[str]) -> Optional[AgentSession]:
    if not token:
        return None
    for sess in SESSIONS.values():
        if sess.token == token:
            return sess
    return None


def active_session() -> Optional[AgentSession]:
    for sess in SESSIONS.values():
        if sess.status in ("created", "running"):
            return sess
    return None


def _base() -> str:
    return PUBLIC_WORKER_URL


def session_json(sess: AgentSession) -> dict:
    live_url = f"{_base()}/vnc/vnc.html?token={sess.token}&autoconnect=true" if _base() else None
    shot_url = (
        f"{_base()}/api/v3/sessions/{sess.id}/screenshot?token={sess.token}" if _base() else None
    )
    return {
        "id": sess.id,
        "status": sess.status,
        "liveUrl": live_url,
        "screenshotUrl": shot_url,
        "lastStepSummary": sess.last_summary or None,
        "output": sess.output,
        "isTaskSuccessful": sess.is_task_successful,
        "stepCount": sess.step_count,
        "title": sess.title or None,
    }


# --------------------------------------------------------------------------- #
# browser-use wiring (version-tolerant)
# --------------------------------------------------------------------------- #

def make_llm(model: str):
    """xAI model through the OpenAI-compatible endpoint."""
    if not XAI_API_KEY:
        raise RuntimeError("XAI_API_KEY is not set on the worker")
    try:
        from browser_use.llm import ChatOpenAI  # browser-use >= 0.2
    except ImportError:
        from langchain_openai import ChatOpenAI  # fallback: raw langchain
    return ChatOpenAI(model=model, api_key=XAI_API_KEY, base_url=XAI_BASE_URL)


def make_browser(allowed_domains: list[str] | None = None):
    from browser_use import Browser

    # allowed_domains is enforced by browser-use itself (deterministic
    # allowlisting — not just a prompt instruction).
    kwargs: dict[str, Any] = {
        "headless": False,  # headed under Xvfb so x11vnc can export it
        "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    }
    if allowed_domains:
        kwargs["allowed_domains"] = allowed_domains
    try:
        return Browser(**kwargs)
    except TypeError as exc:
        log.info("Browser(**kwargs) rejected (%s); retrying minimal", exc)
        return Browser(headless=False)


async def _current_page(agent: Any):
    """Best-effort page lookup across browser-use versions."""
    candidates = []
    for attr in ("browser_session", "browser", "_browser_session"):
        obj = getattr(agent, attr, None)
        if obj is not None:
            candidates.append(obj)
    for obj in candidates:
        for meth in ("get_current_page", "get_page", "current_page"):
            try:
                fn = getattr(obj, meth, None)
                page = fn() if callable(fn) else fn
                if inspect.isawaitable(page):
                    page = await page
                if page is not None:
                    return page
            except Exception:
                continue
    return None


def _coerce_text(value: Any) -> str:
    try:
        text = str(value)
    except Exception:
        return ""
    return text.strip()


async def _screenshot_loop(sess: AgentSession):
    """Refresh the latest frame every ~2.5s while the agent runs."""
    while sess.status == "running" and not sess.stop_requested:
        try:
            agent = sess.agent
            page = await _current_page(agent) if agent is not None else None
            if page is not None:
                png = await page.screenshot(type="png")
                if png:
                    sess.shot = bytes(png)
                    sess.shot_at = time.time()
        except Exception:
            pass
        await asyncio.sleep(2.5)


def _final_result(history: Any) -> str:
    fn = getattr(history, "final_result", None)
    try:
        result = fn() if callable(fn) else fn
        if result:
            return _coerce_text(result)
    except Exception:
        pass
    return ""


async def _run_agent(sess: AgentSession, task: str):
    from browser_use import Agent

    sess.status = "running"
    sess.stop_requested = False
    sess.last_summary = "Agent starting on the portal…"
    sess.push_log("system", f"Task started: {task[:300]}")
    shot_task = asyncio.create_task(_screenshot_loop(sess))

    def on_step(*args: Any):
        sess.step_count += 1
        for arg in args:
            text = _coerce_text(arg)
            if len(text) > 24:
                sess.last_summary = text[:600]
                sess.push_log("agent", sess.last_summary)
                break
        else:
            sess.last_summary = f"Step {sess.step_count} in progress…"

    try:
        agent = Agent(
            task=task,
            llm=make_llm(sess.model),
            browser=sess.browser,
            use_vision=USE_VISION,
            # Constructor hook in current browser-use; absent in older ones
            # (TypeError caught below) — the screenshot poller still works.
            register_new_step_callback=on_step,  # type: ignore[arg-type]
        )
        sess.agent = agent
        history = await asyncio.wait_for(agent.run(), timeout=TASK_TIMEOUT_MIN * 60)
        final = _final_result(history)
        sess.output = final or None
        sess.last_summary = final or sess.last_summary or "Task finished."
        sess.push_log("agent", sess.last_summary)
        upper = (final or "").upper()
        if "FAILED:" in upper:
            sess.is_task_successful = False
        elif "REVIEW_READY" in upper or "PAUSE" in upper:
            sess.is_task_successful = None  # human decision pending — not a failure
        else:
            sess.is_task_successful = True
        sess.status = "stopped" if sess.stop_requested else "idle"
    except asyncio.TimeoutError:
        sess.last_summary = f"Task timed out after {TASK_TIMEOUT_MIN:g} minutes."
        sess.push_log("system", sess.last_summary)
        sess.status = "timed_out"
        try:
            if sess.agent is not None:
                await sess.agent.stop()
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001 — surface agent crashes cleanly
        sess.last_summary = f"Agent error: {exc}"[:600]
        sess.push_log("system", sess.last_summary)
        sess.status = "error"
        log.exception("agent run failed")
    finally:
        shot_task.cancel()
        sess.agent = None
        sess.run_task = None


def _launch(sess: AgentSession, task: str):
    if sess.run_task and not sess.run_task.done():
        raise HTTPException(status_code=409, detail="session already running a task")
    sess.title = task[:80]
    sess.run_task = asyncio.create_task(_run_agent(sess, task))


# --------------------------------------------------------------------------- #
# API — mirrors the Cloud v3 paths SmartPR's client already calls
# --------------------------------------------------------------------------- #

app = FastAPI(title="SmartPR browser-agent worker (xAI)")


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "model_default": XAI_MODEL,
        "xai_key_set": bool(XAI_API_KEY),
        "token_set": bool(WORKER_API_TOKEN),
        "sessions": len(SESSIONS),
    }


@app.post("/api/v3/sessions", dependencies=[Depends(require_api_token)])
async def create_session(body: dict):
    # Dispatch onto an existing idle session (resume path).
    target_id = body.get("sessionId")
    task = str(body.get("task") or "").strip()
    if not task:
        raise HTTPException(status_code=400, detail="task is required")
    model = str(body.get("model") or XAI_MODEL).strip() or XAI_MODEL

    if target_id:
        sess = SESSIONS.get(str(target_id))
        if not sess:
            raise HTTPException(status_code=404, detail="session not found")
        if sess.status in ("created", "running"):
            raise HTTPException(status_code=409, detail="session already running")
        sess.model = model
        _launch(sess, task)
        return session_json(sess)

    busy = active_session()
    if busy:
        raise HTTPException(
            status_code=409,
            detail=f"pilot limit: session {busy.id} is still active; stop it first",
        )
    if not XAI_API_KEY:
        raise HTTPException(status_code=500, detail="XAI_API_KEY is not set on the worker")

    sess_id = f"sess_{uuid.uuid4().hex[:12]}"
    sess = AgentSession(
        id=sess_id,
        token=uuid.uuid4().hex,
        model=model,
    )
    allowed_domains = body.get("allowedDomains")
    if isinstance(allowed_domains, str):
        allowed_domains = [d.strip() for d in allowed_domains.split(",") if d.strip()]
    if not isinstance(allowed_domains, list):
        allowed_domains = None
    try:
        sess.browser = make_browser(allowed_domains)
    except Exception as exc:  # noqa: BLE001
        log.exception("browser launch failed")
        raise HTTPException(status_code=500, detail=f"browser launch failed: {exc}")
    SESSIONS[sess_id] = sess
    sess.push_log("system", f"Session created (model {model}).")
    _launch(sess, task)
    return JSONResponse(session_json(sess), status_code=201)


@app.get("/api/v3/sessions/{session_id}", dependencies=[Depends(require_api_token)])
async def get_session(session_id: str):
    sess = SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    return session_json(sess)


@app.post("/api/v3/sessions/{session_id}/stop", dependencies=[Depends(require_api_token)])
async def stop_session(session_id: str, body: dict | None = None):
    sess = SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    strategy = (body or {}).get("strategy", "session")
    sess.stop_requested = True
    if sess.agent is not None:
        try:
            await sess.agent.stop()
        except Exception:
            pass
    if sess.run_task and not sess.run_task.done():
        sess.run_task.cancel()
    sess.status = "stopped"
    sess.push_log("system", f"Stopped by user (strategy={strategy}).")
    if strategy == "session":
        try:
            if sess.browser is not None:
                await sess.browser.close()
        except Exception:
            pass
        sess.browser = None
    return session_json(sess)


@app.get("/api/v3/sessions/{session_id}/messages", dependencies=[Depends(require_api_token)])
async def list_messages(
    session_id: str,
    after: Optional[str] = Query(default=None),
    pageSize: int = Query(default=20, le=50),
):
    sess = SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    entries = sess.log_entries
    if after:
        idx = next((i for i, e in enumerate(entries) if e.id == after), None)
        entries = entries[idx + 1 :] if idx is not None else entries
    items = [
        {
            "id": e.id,
            "sessionId": sess.id,
            "role": e.role,
            "data": {"text": e.text},
            "summary": e.text,
            "createdAt": e.created_at,
        }
        for e in entries[-pageSize:]
    ]
    return {"items": items, "nextCursor": items[-1]["id"] if items else None}


@app.get("/api/v3/sessions/{session_id}/screenshot")
async def get_screenshot(session_id: str, token: Optional[str] = Query(default=None)):
    sess = SESSIONS.get(session_id)
    if not sess or sess.token != token:
        raise HTTPException(status_code=403, detail="forbidden")
    if not sess.shot:
        raise HTTPException(status_code=404, detail="no screenshot yet")
    return Response(content=sess.shot, media_type="image/png")


# --------------------------------------------------------------------------- #
# Live view — token-gated noVNC viewer + websocket bridge to x11vnc
# --------------------------------------------------------------------------- #

VIEWER_HTML = """<!doctype html>
<html><head><meta charset="utf-8">
<title>Assisted browser — live</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:#0b0b0b}#screen{position:fixed;inset:0}#hint{position:fixed;left:12px;bottom:10px;color:#9aa;font:12px system-ui;opacity:.7}</style>
</head><body>
<div id="screen"></div>
<div id="hint">Live assisted browser — interact directly when asked to take over.</div>
<script type="module">
import RFB from '/vnc/core/rfb.js';
const q = new URLSearchParams(location.search);
const token = q.get('token') || '';
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const url = `${proto}//${location.host}/vnc/websock?token=${encodeURIComponent(token)}`;
const rfb = new RFB(document.getElementById('screen'), url, {});
rfb.addEventListener('connect', () => { document.getElementById('hint').style.display = 'none'; });
rfb.addEventListener('disconnect', (e) => {
  const h = document.getElementById('hint');
  h.style.display = 'block';
  h.textContent = 'Disconnected — press Reconnect in SmartPR to re-establish the stream.';
});
rfb.scaleViewport = true;
</script>
</body></html>
"""


@app.get("/vnc/vnc.html")
async def vnc_viewer(token: Optional[str] = Query(default=None)):
    if not session_by_token(token):
        raise HTTPException(status_code=403, detail="forbidden")
    return Response(content=VIEWER_HTML, media_type="text/html")


@app.websocket("/vnc/websock")
async def vnc_websock(ws: WebSocket):
    token = ws.query_params.get("token")
    if not session_by_token(token):
        await ws.close(code=4403)
        return
    await ws.accept()
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", 5900)
    except Exception:
        await ws.close(code=1011)
        return

    async def ws_to_tcp():
        try:
            while True:
                msg = await ws.receive()
                data = msg.get("bytes")
                if data:
                    writer.write(data)
                    await writer.drain()
                elif msg.get("text"):
                    writer.write(msg["text"].encode())
                    await writer.drain()
                else:
                    break
        except Exception:
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    async def tcp_to_ws():
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                await ws.send_bytes(data)
        except Exception:
            pass
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.gather(ws_to_tcp(), tcp_to_ws())


# noVNC client assets (core/rfb.js + deps). Registered after the explicit
# /vnc routes so the token gates above take precedence.
if os.path.isdir(NOVNC_DIR):
    app.mount("/vnc", StaticFiles(directory=NOVNC_DIR, html=False), name="novnc")
else:
    log.warning("NOVNC_DIR %s not found — live viewer assets unavailable", NOVNC_DIR)
