# Agency Run UI skeleton (Phase 2)

## What shipped
- Business profile card **File with agency assistant** → `/businesses/[id]/agency-run`
- Preflight (filing type, hard rules, gotcha hints) + live run panel (step log, screenshot, filmstrip, status pill)
- Pause overlays for `USER_UPLOAD` | `USER_LOGIN` | `CAPTCHA` with Resume / Stop
- Upload pause hooks into existing `/api/evidence` Evidence Locker (tags `DOC_PHOTO_ID`, `DOC_UTILITY_BILL`, `DOC_SSN_CARD`) and enforces **5 MB** client-side for SURI
- Review state: last screenshot + “You submit on the portal”
- API stubs: `POST /api/agency-runs`, `GET /api/agency-runs/[id]`, `POST .../resume`, `POST .../stop`
- Mock worker: in-memory timeline advances on GET poll with SVG placeholder screenshots — **no Playwright / real SURI automation**

## Persistence note
Runs live in a **process-local `Map`** (`frontend/src/lib/agency-runs/store.ts`, keyed by run id). Fine for UI demos; replace with `agency_runs` / `agency_run_events` tables in a follow-up.

## Demo
1. Open any business profile → **File with agency assistant** → **Open assistant**
2. Leave filing type as Register Taxpayer → **Start agency run**
3. Watch the step log + screenshots advance (~1s polls)
4. At upload pause: optionally upload a ≤5 MB file to the locker → **Resume**
5. At login pause → **Resume**
6. Land on **Review** — agent never submits
