/**
 * Teach Clara v1 — described playbooks (lib/agency-runs/teach/taughtPlaybooks.ts).
 *
 * GET  /api/clara-playbooks?requirement_key=…&portal_url=…
 *   → { signed_in, live_recorder, playbooks: [...] }  (the viewer's own, newest first)
 * POST /api/clara-playbooks  { requirement_key, requirement_name, agency?, portal_url, steps[], bindings?, attachments?, notes? }
 *   → 201 { playbook }  (a new version for the same requirement + portal)
 */
import { currentViewer, unauthorized } from "../../../lib/agency-runs/teach/routeContext";
import { teachAvailability } from "../../../lib/agency-runs/teach/teachWorkerClient";
import { PlaybookError, playbookRepo, playbookSummary, portalHostOf, saveTaughtPlaybook, type TaughtPlaybookInput } from "../../../lib/agency-runs/teach/taughtPlaybooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const viewer = await currentViewer().catch(() => null);
  const live_recorder = teachAvailability().ok;
  if (!viewer) return Response.json({ signed_in: false, live_recorder, playbooks: [] });
  const q = new URL(req.url).searchParams;
  let host: string | undefined;
  try {
    host = q.get("portal_url") ? portalHostOf(q.get("portal_url")!) : undefined;
  } catch {
    host = undefined;
  }
  const repo = await playbookRepo();
  const requirementKey = q.get("requirement_key") || undefined;
  let rows = await repo.list(viewer.userId, { requirementKey, host });
  if (!rows.length && requirementKey) rows = await repo.list(viewer.userId, { requirementKey });
  return Response.json({ signed_in: true, live_recorder, playbooks: rows.map(playbookSummary) });
}

export async function POST(req: Request) {
  const viewer = await currentViewer().catch(() => null);
  if (!viewer) return unauthorized();
  let body: TaughtPlaybookInput;
  try {
    body = (await req.json()) as TaughtPlaybookInput;
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  try {
    const pb = await saveTaughtPlaybook(await playbookRepo(), viewer.userId, body);
    return Response.json({ playbook: playbookSummary(pb) }, { status: 201 });
  } catch (err) {
    if (err instanceof PlaybookError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    return Response.json({ error: "server_error", message: "Could not save the playbook." }, { status: 500 });
  }
}
