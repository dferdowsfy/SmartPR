/**
 * POST /api/teach-sessions/[id]/answer — answer one mapping-dialogue question.
 *
 * Body: { question_id, answer } where answer is one of
 *   { kind: "mapping", choice: "confirm" | "ask" | "always" }
 *   { kind: "mapping", choice: "correct", path }
 *   { kind: "yes_no", value: "yes" | "no" | "not_sure" }
 *   { kind: "branch", path, equals? } | { kind: "branch", notSure: true }
 */
import { currentViewer, errorResponse, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";
import { answerTeachQuestion } from "../../../../../lib/agency-runs/teach/teachSessions";
import type { TeachAnswer } from "../../../../../lib/agency-runs/teach/teachSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAnswer(raw: unknown): TeachAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.kind === "mapping") {
    if (a.choice === "confirm" || a.choice === "ask" || a.choice === "always") return { kind: "mapping", choice: a.choice };
    if (a.choice === "correct" && typeof a.path === "string") return { kind: "mapping", choice: "correct", path: a.path };
    return null;
  }
  if (a.kind === "yes_no" && (a.value === "yes" || a.value === "no" || a.value === "not_sure")) return { kind: "yes_no", value: a.value };
  if (a.kind === "branch") {
    if (a.notSure === true) return { kind: "branch", notSure: true };
    if (typeof a.path !== "string") return null;
    const eq = a.equals;
    if (eq === undefined || eq === null || eq === "") return { kind: "branch", path: a.path };
    if (typeof eq === "string" || typeof eq === "number" || typeof eq === "boolean") return { kind: "branch", path: a.path, equals: typeof eq === "string" ? eq.slice(0, 80) : eq };
  }
  return null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const answer = parseAnswer(body.answer);
  if (typeof body.question_id !== "string" || !answer) {
    return Response.json({ error: "bad_request", message: "question_id and a valid answer are required." }, { status: 400 });
  }
  try {
    return Response.json({ session: answerTeachQuestion(viewer, id, body.question_id, answer) });
  } catch (err) {
    return errorResponse(err);
  }
}
