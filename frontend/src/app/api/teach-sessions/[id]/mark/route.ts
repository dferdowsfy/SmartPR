/**
 * POST /api/teach-sessions/[id]/mark — the teacher labels a screen.
 *
 * Body: { step_id, gate?: GateId | null, conditional?: true }
 *    or { add_step: { title, gate? } }   (a screen they didn't walk through)
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
    if (typeof body.step_id !== "string") return Response.json({ error: "bad_request", message: "step_id required." }, { status: 400 });
    const gate = "gate" in body ? gateOf(body.gate) : undefined;
    if ("gate" in body && gate === undefined) return Response.json({ error: "bad_request", message: "Unknown gate." }, { status: 400 });
    return Response.json({ session: markTeachStep(viewer, id, { stepId: body.step_id, gate, conditional: body.conditional === true }) });
  } catch (err) {
    return errorResponse(err);
  }
}
