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
  POST   /api/v4/teach                     {startUrl, allowedDomains, recorderScript}
  GET    /api/v4/teach/{id}/events         ?after=     (recorder events, structure only)
  POST   /api/v4/teach/{id}/stop
  POST   /api/v4/drive                     {startUrl, allowedDomains, driverScript}  (skill replay)
  POST   /api/v4/drive/{id}/call           {op: snapshot|locate|fill|selectOption|click|settle, ...}
  POST   /api/v4/drive/{id}/stop

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
from pydantic import BaseModel

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
    seq: int = 0  # monotonic per-session id for the v4 events cursor


@dataclass
class AgentRun:
    """One v4 run (agent turn) on a session (conversation)."""

    id: str
    session_id: str
    task: str
    model: str
    status: str = "queued"  # queued|running|completed|failed|cancelled
    result: Optional[str] = None
    error: Optional[str] = None
    cancelled: bool = False
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


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
    runs: list[AgentRun] = field(default_factory=list)
    current_run_id: Optional[str] = None
    event_seq: int = 0
    # Teach mode (Teach Clara): a plain Playwright browser with the
    # structure-only recorder injected, instead of a browser-use agent.
    kind: str = "agent"  # agent|teach
    teach_events: list[dict] = field(default_factory=list)
    teach_seq: int = 0
    teach_handles: dict = field(default_factory=dict)
    teach_allowed: list[str] = field(default_factory=list)

    def push_log(self, role: str, text: str) -> SessionLog:
        self.event_seq += 1
        entry = SessionLog(
            id=f"msg_{uuid.uuid4().hex[:12]}",
            role=role,
            text=text[:2000],
            created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            seq=self.event_seq,
        )
        self.log_entries.append(entry)
        return entry

    def current_run(self) -> Optional[AgentRun]:
        if not self.current_run_id:
            return None
        return next((r for r in self.runs if r.id == self.current_run_id), None)


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


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def run_status(sess: AgentSession, run: AgentRun) -> str:
    """Map worker state onto the v4 run statuses. Terminal states are
    snapshotted on the run so a later follow-up turn can't rewrite history."""
    if run.status in ("completed", "failed", "cancelled"):
        return run.status
    if run.cancelled or sess.stop_requested:
        return "cancelled"
    return {"created": "queued", "running": "running"}.get(sess.status, "queued")


def run_json(sess: AgentSession, run: AgentRun) -> dict:
    live_url = f"{_base()}/vnc/vnc.html?token={sess.token}&autoconnect=true" if _base() else None
    shot_url = (
        f"{_base()}/api/v3/sessions/{sess.id}/screenshot?token={sess.token}" if _base() else None
    )
    return {
        "id": run.id,
        "task": run.task,
        "title": sess.title or None,
        "model": run.model,
        "status": run_status(sess, run),
        "result": run.result,
        "error": run.error,
        "sessionId": sess.id,
        "workspaceId": None,
        "totalInputTokens": 0,
        "totalOutputTokens": 0,
        "totalCostUsd": None,
        "createdAt": _iso(run.created_at),
        "updatedAt": _iso(run.updated_at),
        # Worker extras (not in the Cloud v4 contract, harmless):
        "liveUrl": live_url,
        "screenshotUrl": shot_url,
        "lastStepSummary": sess.last_summary or None,
    }


def find_run(run_id: str) -> tuple[Optional[AgentSession], Optional[AgentRun]]:
    for sess in SESSIONS.values():
        for run in sess.runs:
            if run.id == run_id:
                return sess, run
    return None, None


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


async def _run_agent(sess: AgentSession, run: AgentRun):
    from browser_use import Agent

    task = run.task
    sess.status = "running"
    sess.stop_requested = False
    run.status = "running"
    run.updated_at = time.time()
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
            llm=make_llm(run.model),
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
        run.result = final or sess.last_summary or None
        if sess.stop_requested or run.cancelled:
            run.status = "cancelled"
            sess.status = "stopped"
        else:
            run.status = "completed"
            sess.status = "idle"
    except asyncio.TimeoutError:
        sess.last_summary = f"Task timed out after {TASK_TIMEOUT_MIN:g} minutes."
        sess.push_log("system", sess.last_summary)
        sess.status = "timed_out"
        run.status = "failed"
        run.error = sess.last_summary
        try:
            if sess.agent is not None:
                await sess.agent.stop()
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001 — surface agent crashes cleanly
        sess.last_summary = f"Agent error: {exc}"[:600]
        sess.push_log("system", sess.last_summary)
        sess.status = "error"
        run.status = "failed"
        run.error = sess.last_summary
        log.exception("agent run failed")
    finally:
        run.updated_at = time.time()
        shot_task.cancel()
        sess.agent = None
        sess.run_task = None
        if sess.current_run_id == run.id:
            sess.current_run_id = None


def _launch(sess: AgentSession, task: str, model: Optional[str] = None) -> AgentRun:
    if sess.run_task and not sess.run_task.done():
        raise HTTPException(status_code=409, detail="session already running a task")
    run = AgentRun(
        id=f"run_{uuid.uuid4().hex[:12]}",
        session_id=sess.id,
        task=task,
        model=model or sess.model,
    )
    sess.runs.append(run)
    sess.current_run_id = run.id
    sess.title = task[:80]
    sess.run_task = asyncio.create_task(_run_agent(sess, run))
    return run


def _cancel_run(sess: AgentSession, run: AgentRun):
    """Best-effort cancel of the active run; snapshots the terminal state."""
    run.cancelled = True
    sess.stop_requested = True
    if sess.agent is not None:
        try:
            # Can't await here from sync context — the run loop notices
            # stop_requested and the agent's own stop is attempted async.
            pass
        except Exception:
            pass
    if sess.run_task and not sess.run_task.done():
        sess.run_task.cancel()
    if run.status not in ("completed", "failed"):
        run.status = "cancelled"
    run.updated_at = time.time()
    sess.status = "stopped"
    sess.push_log("system", "Run cancelled by user.")


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
    cur = sess.current_run()
    if cur:
        _cancel_run(sess, cur)
    else:
        sess.stop_requested = True
        sess.status = "stopped"
    if sess.agent is not None:
        try:
            await sess.agent.stop()
        except Exception:
            pass
    if sess.run_task and not sess.run_task.done():
        sess.run_task.cancel()
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
# API v4 — mirrors the Cloud v4 run/session shapes the Next.js client uses
# --------------------------------------------------------------------------- #

class RunCreateV4(BaseModel):
    task: str
    model: Optional[str] = None
    sessionId: Optional[str] = None
    allowedDomains: Optional[list[str]] = None


@app.post("/api/v4/runs", dependencies=[Depends(require_api_token)])
async def v4_create_run(body: RunCreateV4):
    task = (body.task or "").strip()
    if not task:
        raise HTTPException(status_code=400, detail="task is required")
    model = (body.model or XAI_MODEL).strip() or XAI_MODEL

    sess: Optional[AgentSession] = None
    if body.sessionId:
        sess = SESSIONS.get(body.sessionId)
        if not sess:
            raise HTTPException(status_code=404, detail="session not found")
        if sess.run_task and not sess.run_task.done():
            raise HTTPException(status_code=409, detail="session already running a task")
        sess.model = model
    else:
        sess = active_session()
        if sess:
            raise HTTPException(
                status_code=409,
                detail=f"pilot limit: session {sess.id} is still active; stop it first",
            )
        if not XAI_API_KEY:
            raise HTTPException(status_code=500, detail="XAI_API_KEY is not set on the worker")
        sess = AgentSession(
            id=f"sess_{uuid.uuid4().hex[:12]}",
            token=uuid.uuid4().hex,
            model=model,
        )
        allowed = body.allowedDomains if isinstance(body.allowedDomains, list) else None
        try:
            sess.browser = make_browser(allowed)
        except Exception as exc:  # noqa: BLE001
            log.exception("browser launch failed")
            raise HTTPException(status_code=500, detail=f"browser launch failed: {exc}")
        SESSIONS[sess.id] = sess
        sess.push_log("system", f"Session created (model {model}).")

    run = _launch(sess, task, model)
    return JSONResponse(run_json(sess, run), status_code=201)


@app.get("/api/v4/runs/{run_id}", dependencies=[Depends(require_api_token)])
async def v4_get_run(run_id: str):
    sess, run = find_run(run_id)
    if not sess or not run:
        raise HTTPException(status_code=404, detail="run not found")
    return run_json(sess, run)


@app.get("/api/v4/runs/{run_id}/status", dependencies=[Depends(require_api_token)])
async def v4_run_status(run_id: str):
    sess, run = find_run(run_id)
    if not sess or not run:
        raise HTTPException(status_code=404, detail="run not found")
    return {"status": run_status(sess, run)}


@app.post("/api/v4/runs/{run_id}/cancel", dependencies=[Depends(require_api_token)])
async def v4_cancel_run(run_id: str):
    sess, run = find_run(run_id)
    if not sess or not run:
        raise HTTPException(status_code=404, detail="run not found")
    _cancel_run(sess, run)
    return run_json(sess, run)


@app.get("/api/v4/runs/{run_id}/events", dependencies=[Depends(require_api_token)])
async def v4_run_events(
    run_id: str,
    after: Optional[int] = Query(default=None),
    limit: int = Query(default=20, le=50),
):
    sess, run = find_run(run_id)
    if not sess or not run:
        raise HTTPException(status_code=404, detail="run not found")
    entries = sess.log_entries
    if after is not None:
        entries = [e for e in entries if e.seq > after]
    items = [
        {
            "runId": run.id,
            "id": e.seq,
            "ts": e.created_at,
            "type": "agent.message" if e.role == "agent" else f"session.{e.role}",
            "data": {"text": e.text},
        }
        for e in entries[:limit]
    ]
    next_after = items[-1]["id"] if items else after
    return {"events": items, "nextAfter": next_after}


class SessionQueueV4(BaseModel):
    text: str
    interrupt: bool = False


@app.post("/api/v4/sessions/{session_id}/queue", dependencies=[Depends(require_api_token)])
async def v4_queue_message(session_id: str, body: SessionQueueV4):
    sess = SESSIONS.get(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="session not found")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    sess.push_log("user", f"Follow-up: {text[:300]}")
    if sess.run_task and not sess.run_task.done():
        raise HTTPException(status_code=409, detail="session already running a task")
    run = _launch(sess, text)
    return {"id": run.id, "sessionId": sess.id, "runId": run.id, "mode": "new_run"}


@app.get("/api/v4/browsers", dependencies=[Depends(require_api_token)])
async def v4_browsers(
    agentSessionId: Optional[str] = Query(default=None),
    pageSize: int = Query(default=10, le=50),
):
    items = []
    for sess in SESSIONS.values():
        if agentSessionId and sess.id != agentSessionId:
            continue
        if sess.browser is None:
            continue
        live_url = (
            f"{_base()}/vnc/vnc.html?token={sess.token}&autoconnect=true" if _base() else None
        )
        items.append(
            {
                "id": sess.id,
                "status": "running" if sess.status in ("created", "running") else "stopped",
                "liveUrl": live_url,
                "agentSessionId": sess.id,
                "timeout": TASK_TIMEOUT_MIN,
            }
        )
    return {
        "items": items[:pageSize],
        "totalItems": len(items),
        "pageNumber": 1,
        "pageSize": pageSize,
    }


# --------------------------------------------------------------------------- #
# Teach mode — the user walks a filing in this browser; the injected recorder
# reports structure only (labels, roles, selectors, page order, value KIND —
# never values). SmartPR's server re-sanitizes every event. Navigation is
# held to the allowed domains; the user signs in themselves via the viewer.
# --------------------------------------------------------------------------- #

TEACH_TIMEOUT_MIN = float(os.environ.get("TEACH_TIMEOUT_MIN", "45") or 45)
# Optional: a specific Chromium build for Playwright (default: its bundled one).
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH", "").strip() or None
# Development only (local HTTPS fixtures with self-signed certs). Never set in production.
TEACH_IGNORE_HTTPS_ERRORS = (os.environ.get("TEACH_IGNORE_HTTPS_ERRORS", "") or "").lower() in ("1", "true", "yes")
TEACH_MAX_EVENTS = 5000
TEACH_MAX_EVENT_BYTES = 4000
TEACH_MAX_SCRIPT_BYTES = 100_000
_TEACH_EVENT_KEYS = {
    "kind", "url", "title", "heading", "hasPassword", "hasCaptcha", "hasFileInput",
    "role", "label", "selector", "inputType", "valueKind", "required", "optionText",
}


class TeachCreate(BaseModel):
    startUrl: str
    allowedDomains: list[str] = []
    recorderScript: str


def _host_allowed(url: str, patterns: list[str]) -> bool:
    from urllib.parse import urlparse

    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    if not host:
        return False
    for pattern in patterns:
        p = pattern.lower()
        if p.startswith("*."):
            p = p[2:]
        if host == p or host.endswith("." + p):
            return True
    return False


def _teach_record(sess: AgentSession, payload: Any) -> None:
    """Binding target for window.__claraRecord — keep whitelisted keys only."""
    import json

    if len(sess.teach_events) >= TEACH_MAX_EVENTS:
        return
    try:
        text = payload if isinstance(payload, str) else json.dumps(payload)
        if len(text) > TEACH_MAX_EVENT_BYTES:
            return
        raw = json.loads(text)
    except Exception:
        return
    if not isinstance(raw, dict):
        return
    event = {k: v for k, v in raw.items() if k in _TEACH_EVENT_KEYS}
    sess.teach_seq += 1
    sess.teach_events.append({"seq": sess.teach_seq, "event": event})


async def _teach_close(sess: AgentSession) -> None:
    handles = sess.teach_handles
    sess.teach_handles = {}
    for key in ("context", "browser"):
        obj = handles.get(key)
        if obj is not None:
            try:
                await obj.close()
            except Exception:
                pass
    pw = handles.get("pw")
    if pw is not None:
        try:
            await pw.stop()
        except Exception:
            pass
    task = handles.get("timer")
    if task is not None and not task.done():
        task.cancel()


async def _teach_screenshot_loop(sess: AgentSession) -> None:
    while sess.status == "running" and sess.kind == "teach":
        try:
            ctx = sess.teach_handles.get("context")
            pages = ctx.pages if ctx is not None else []
            if pages:
                sess.shot = bytes(await pages[-1].screenshot(type="png"))
                sess.shot_at = time.time()
        except Exception:
            pass
        await asyncio.sleep(2.5)


async def _teach_timeout(sess: AgentSession) -> None:
    await asyncio.sleep(TEACH_TIMEOUT_MIN * 60)
    if sess.status == "running":
        sess.status = "timed_out"
        sess.push_log("system", "Teach session timed out.")
        await _teach_close(sess)


@app.post("/api/v4/teach", dependencies=[Depends(require_api_token)])
async def teach_create(body: TeachCreate):
    return await _open_plain_browser(body.startUrl, body.allowedDomains, body.recorderScript, record=True)


async def _open_plain_browser(start_url: str, allowed_domains: list[str], script: str, record: bool):
    """Plain Playwright browser on the live-view display with `script`
    injected on every page (teach recorder or replay driver)."""
    busy = active_session()
    if busy:
        raise HTTPException(status_code=409, detail=f"pilot limit: session {busy.id} is still active; stop it first")
    if not start_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="startUrl must be https")
    allowed = [d for d in allowed_domains if isinstance(d, str) and d.strip()][:20]
    if not allowed or not _host_allowed(start_url, allowed):
        raise HTTPException(status_code=400, detail="startUrl is outside allowedDomains")
    if not script or len(script) > TEACH_MAX_SCRIPT_BYTES:
        raise HTTPException(status_code=400, detail="script missing or too large")

    sess = AgentSession(id=f"teach_{uuid.uuid4().hex[:12]}", token=uuid.uuid4().hex, model="teach")
    sess.kind = "teach"
    sess.status = "running"
    sess.title = "Teach Clara" if record else "Clara replay"
    sess.teach_allowed = allowed
    SESSIONS[sess.id] = sess
    try:
        from playwright.async_api import async_playwright

        pw = await async_playwright().start()
        sess.teach_handles["pw"] = pw
        browser = await pw.chromium.launch(
            headless=False,
            executable_path=CHROMIUM_PATH,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--start-maximized"],
        )
        sess.teach_handles["browser"] = browser
        context = await browser.new_context(
            viewport={"width": 1280, "height": 760}, ignore_https_errors=TEACH_IGNORE_HTTPS_ERRORS
        )
        sess.teach_handles["context"] = context
        if record:
            await context.expose_binding("__claraRecord", lambda _source, payload: _teach_record(sess, payload))
        await context.add_init_script(script=script)

        async def guard(route, request):
            frame = request.frame
            is_top = frame is not None and frame.parent_frame is None
            if request.is_navigation_request() and is_top and not _host_allowed(request.url, sess.teach_allowed):
                sess.push_log("system", "Blocked navigation outside the allowed sites.")
                await route.abort("blockedbyclient")
                return
            await route.continue_()

        await context.route("**/*", guard)
        page = await context.new_page()
        try:
            await page.goto(start_url, wait_until="domcontentloaded", timeout=45_000)
        except Exception as exc:  # the user can still navigate from the viewer
            sess.push_log("system", f"Start page load issue: {type(exc).__name__}")
    except Exception as exc:  # noqa: BLE001
        log.exception("teach browser launch failed")
        sess.status = "error"
        await _teach_close(sess)
        raise HTTPException(status_code=500, detail=f"teach browser launch failed: {type(exc).__name__}")

    sess.teach_handles["timer"] = asyncio.create_task(_teach_timeout(sess))
    asyncio.create_task(_teach_screenshot_loop(sess))
    sess.push_log("system", "Teach session started.")
    live_url = f"{_base()}/vnc/vnc.html?token={sess.token}&autoconnect=true" if _base() else None
    return JSONResponse({"sessionId": sess.id, "liveUrl": live_url}, status_code=201)


@app.get("/api/v4/teach/{session_id}/events", dependencies=[Depends(require_api_token)])
async def teach_events(session_id: str, after: int = Query(default=0, ge=0)):
    sess = SESSIONS.get(session_id)
    if not sess or sess.kind != "teach":
        raise HTTPException(status_code=404, detail="teach session not found")
    items = [e for e in sess.teach_events if e["seq"] > after][:500]
    next_after = items[-1]["seq"] if items else after
    return {"items": items, "nextAfter": next_after, "status": sess.status}


@app.post("/api/v4/teach/{session_id}/stop", dependencies=[Depends(require_api_token)])
async def teach_stop(session_id: str):
    sess = SESSIONS.get(session_id)
    if not sess or sess.kind != "teach":
        raise HTTPException(status_code=404, detail="teach session not found")
    if sess.status == "running":
        sess.status = "stopped"
        sess.push_log("system", "Teach session stopped.")
    await _teach_close(sess)
    return {"sessionId": sess.id, "status": sess.status}


# --------------------------------------------------------------------------- #
# Drive mode — skill replay. SmartPR's server runs the replay engine and
# calls these primitives; DRIVER_SCRIPT (sent by SmartPR) finds and tags
# controls, Playwright types/clicks on the tagged element. The worker never
# decides what to fill or click, and refuses nothing it isn't asked.
# --------------------------------------------------------------------------- #

class DriveCreate(BaseModel):
    startUrl: str
    allowedDomains: list[str] = []
    driverScript: str


class DriveCall(BaseModel):
    op: str
    target: Optional[dict] = None
    ref: Optional[str] = None
    value: Optional[str] = None


def _drive_page(sess: AgentSession):
    ctx = sess.teach_handles.get("context")
    if ctx is None or not ctx.pages:
        raise HTTPException(status_code=409, detail="browser closed")
    return ctx.pages[-1]


def _ref_selector(ref: Optional[str]) -> str:
    import re

    clean = re.sub(r"[^a-zA-Z0-9]", "", ref or "")
    if not clean:
        raise HTTPException(status_code=400, detail="ref required")
    return f'[data-clara-ref="{clean}"]'


@app.post("/api/v4/drive", dependencies=[Depends(require_api_token)])
async def drive_create(body: DriveCreate):
    return await _open_plain_browser(body.startUrl, body.allowedDomains, body.driverScript, record=False)


@app.post("/api/v4/drive/{session_id}/call", dependencies=[Depends(require_api_token)])
async def drive_call(session_id: str, body: DriveCall):
    sess = SESSIONS.get(session_id)
    if not sess or sess.kind != "teach" or sess.status != "running":
        raise HTTPException(status_code=404, detail="drive session not found")
    page = _drive_page(sess)
    op = body.op
    if op == "snapshot":
        return await page.evaluate("() => window.__claraDrive.snapshot()")
    if op == "locate":
        t = body.target or {}
        target = {"role": str(t.get("role", "")), "label": str(t.get("label", ""))[:200], "selector": t.get("selector")}
        return await page.evaluate("(t) => window.__claraDrive.locate(t)", target)
    if op == "fill":
        await page.locator(_ref_selector(body.ref)).fill(body.value or "")
        return {"ok": True}
    if op == "selectOption":
        loc = page.locator(_ref_selector(body.ref))
        labels = await loc.evaluate("(s) => Array.from(s.options).map(o => o.text.trim())")
        norm = lambda x: x.lower()
        want = norm(body.value or "")
        exact = [l for l in labels if norm(l) == want]
        partial = [l for l in labels if want and want in norm(l)]
        pick = exact[0] if len(exact) == 1 else (partial[0] if not exact and len(partial) == 1 else None)
        if pick is None:
            return {"ok": False}
        await loc.select_option(label=pick)
        return {"ok": True}
    if op == "click":
        loc = page.locator(_ref_selector(body.ref))
        kind = await loc.evaluate("(e) => e.type || ''")
        if kind in ("radio", "checkbox"):
            await loc.check(force=True)
        else:
            await loc.click()
        return {"ok": True}
    if op == "settle":
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=10_000)
        except Exception:
            pass
        await asyncio.sleep(0.4)
        return {"ok": True}
    raise HTTPException(status_code=400, detail="unknown op")


@app.post("/api/v4/drive/{session_id}/stop", dependencies=[Depends(require_api_token)])
async def drive_stop(session_id: str):
    return await teach_stop(session_id)


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
