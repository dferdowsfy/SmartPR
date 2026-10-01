/**
 * POST /api/clara-recordings/steps { frames: dataURL[], requirement_name, portal_url?, language? }
 *
 * "Recording needs a desktop" fallback: turn frames sampled from an
 * uploaded screen recording into draft steps (labels only). Nothing is
 * stored here — the person checks the steps and saves them as a described
 * playbook. 503 when no vision model is configured.
 */
import { getCurrentUser } from "../../../../lib/supabase/server";
import { rateLimitAllow } from "../../../../lib/rateLimit";
import { readStepsFromFrames, validFrames, videoStepsPrompt } from "../../../../lib/agency-runs/teach/videoSteps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return Response.json({ error: "sign_in_required", message: { en: "Sign in so Clara can read your recording.", es: "Entra a tu cuenta para que Clara lea tu grabación." } }, { status: 401 });
  if (!rateLimitAllow(`clara-video:${user.id}`, 6, 60_000)) return Response.json({ error: "rate_limited", message: { en: "Too many recordings at once — try again in a minute.", es: "Demasiadas grabaciones a la vez — intenta en un minuto." } }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const frames = validFrames(body.frames);
  if (!frames.length) return Response.json({ error: "bad_request", message: { en: "Couldn't read frames from that video.", es: "No se pudieron leer imágenes de ese video." } }, { status: 400 });
  const prompt = videoStepsPrompt({
    requirementName: String(body.requirement_name ?? "this filing").slice(0, 200),
    portalUrl: typeof body.portal_url === "string" && /^https?:\/\//.test(body.portal_url) ? body.portal_url.slice(0, 300) : null,
    language: body.language === "es" ? "es" : "en",
  });
  try {
    const steps = await readStepsFromFrames(frames, prompt);
    if (!steps.length) return Response.json({ error: "no_steps", message: { en: "Clara couldn't find steps in that recording — describe them instead.", es: "Clara no encontró pasos en esa grabación — descríbelos tú." } }, { status: 422 });
    return Response.json({ steps });
  } catch (err) {
    const notConfigured = (err as Error).message === "not_configured";
    return Response.json(
      { error: notConfigured ? "unavailable" : "model_error", message: { en: "Clara can't read videos here yet — type the steps instead.", es: "Clara todavía no puede leer videos aquí — escribe los pasos." } },
      { status: 503 }
    );
  }
}
