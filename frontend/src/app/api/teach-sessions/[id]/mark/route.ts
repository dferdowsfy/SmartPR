/**
 * POST /api/teach-sessions/[id]/mark — the teacher labels a screen.
 *
 * Body: { step_id, gate?: GateId | null, conditional?: true }
 *    or { add_step: { title, gate? } }   (a screen they didn't walk through)
 *    or { remove_step: step_id }         (Edit steps: accidental / repeated screen)
 *    or { remove_action: { step_id, action_key } }  (Edit steps: stray click)
 *    or { rebind: { step_id, field_key, path | null } }  (null = ask each time)
 */
import { currentViewer, errorResponse, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";
import { markTeachStep } from "../../../../../lib/agency-runs/teach/teachSessions";
import type { TeachGate } from "../../../../../lib/agency-runs/teach/teachSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATES: TeachGate[] = ["login", "mfa", "captcha", "certification", "signature", "payment", "submit", "upload", "identity"];
const gateOf = (v: unknown): TeachGate | null | undefined =>
  v === null ? null : GATES.find((g) => g === v);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.add_step && typeof body.add_step === "object") {
      const add = body.add_step as Record<string, unknown>;
      return Response.json({
        session: markTeachStep(viewer, id, { addStep: { title: String(add.title ?? ""), gate: gateOf(add.gate) ?? null } }),
      });
    }
    // Edit steps (record-first Teach): remove a screen / a stray click, re-bind a field.
    if (typeof body.remove_step === "string") return Response.json({ session: markTeachStep(viewer, id, { removeStep: body.remove_step }) });
    if (body.remove_action && typeof body.remove_action === "object") {
      const r = body.remove_action as Record<string, unknown>;
      return Response.json({ session: markTeachStep(viewer, id, { removeAction: { stepId: String(r.step_id ?? ""), actionKey: String(r.action_key ?? "") } }) });
    }
    if (body.rebind && typeof body.rebind === "object") {
      const r = body.rebind as Record<string, unknown>;
      const path = typeof r.path === "string" && r.path ? r.path : null;
      return Response.json({ session: markTeachStep(viewer, id, { rebind: { stepId: String(r.step_id ?? ""), fieldKey: String(r.field_key ?? ""), path } }) });
    }
    if (typeof body.step_id !== "string") return Response.json({ error: "bad_request", message: "step_id required." }, { status: 400 });
    const gate = "gate" in body ? gateOf(body.gate) : undefined;
    if ("gate" in body && gate === undefined) return Response.json({ error: "bad_request", message: "Unknown gate." }, { status: 400 });
    return Response.json({ session: markTeachStep(viewer, id, { stepId: body.step_id, gate, conditional: body.conditional === true }) });
  } catch (err) {
    return errorResponse(err);
  }
}
