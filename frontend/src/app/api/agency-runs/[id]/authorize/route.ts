/**
 * POST /api/agency-runs/[id]/authorize — "File it for me".
 *
 * The owner explicitly authorizes SmartPR to click final submit for a run
 * that has reached pre-submit review. Requires an explicit attestation in
 * the request body — the UI checkbox ("I authorize SmartPR to submit this
 * filing on my behalf; the information is true and correct") must be true.
 *
 * The submit permission reaches the agent ONLY through the server-built
 * authorize prompt (see authorizeFiling) — never from client input.
 */
import { assertRunOwner, authorizeFiling, peekRun } from "../../../../../lib/agency-runs/store";
import { getCurrentUser } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const peek = peekRun(id);
  if (!peek) return Response.json({ error: "not_found" }, { status: 404 });

  const user = await getCurrentUser();
  if (!assertRunOwner(peek, user?.id ?? null)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let attestation = false;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      attestation = (body as { attestation?: unknown } | null)?.attestation === true;
    }
  } catch {
    // Non-JSON body — attestation stays false.
  }

  if (!attestation) {
    return Response.json(
      { error: "attestation_required" },
      { status: 400 }
    );
  }

  if (peek.status !== "review") {
    return Response.json(
      { error: "not_in_review", status: peek.status },
      { status: 409 }
    );
  }

  const run = await authorizeFiling(id);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
