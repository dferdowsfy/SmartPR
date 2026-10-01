/**
 * Screen recording → draft steps (the "Recording needs a desktop" fallback).
 *
 * The browser samples a few frames of the person's screen recording; the
 * model reads them and writes the filing as short, plain steps — screen
 * names, buttons and field labels only, never what was typed. Steps are
 * scrubbed again here and become a DRAFT the person checks and saves as a
 * described playbook (guidance). A video doesn't give selectors, so this is
 * never a "Learned" strict routine — the UI says so.
 */
import { scrubSecrets } from "./taughtPlaybooks";

export const VIDEO_LIMITS = { frames: 10, frameChars: 400_000 } as const;

export function validFrames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is string => typeof f === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f) && f.length <= VIDEO_LIMITS.frameChars)
    .slice(0, VIDEO_LIMITS.frames);
}

export function parseVideoSteps(raw: string): string[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { steps?: unknown };
    return (Array.isArray(parsed.steps) ? parsed.steps : [])
      .filter((s): s is string => typeof s === "string")
      .map((s) => scrubSecrets(s).replace(/\s+/g, " ").trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 25);
  } catch {
    return [];
  }
}

export function videoStepsPrompt(input: { requirementName: string; portalUrl: string | null; language: "en" | "es" }): string {
  return [
    `These are frames, in order, from a screen recording of someone filing "${input.requirementName}"${input.portalUrl ? ` on ${input.portalUrl}` : ""}.`,
    `Write the filing as short numbered steps in ${input.language === "es" ? "Spanish" : "English"}: which screen, which button or link, which field gets which kind of business information.`,
    "Never copy what was typed (names, numbers, emails, addresses, passwords, codes). Mark sign-in, verification codes, document uploads, payment and signature as 'You do this part'. Stop at the review screen; never include the final submit.",
    'Reply with JSON only: {"steps": ["...", "..."]}',
  ].join("\n");
}

/** xAI Responses call with image frames (labels-only output). */
export async function readStepsFromFrames(frames: string[], prompt: string): Promise<string[]> {
  const key = process.env.XAI_API_KEY || "";
  if (!key) throw new Error("not_configured");
  const base = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "");
  const model = process.env.XAI_VISION_MODEL || process.env.XAI_MODEL || "grok-4.3";
  const res = await fetch(`${base}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 1200,
      temperature: 0,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }, ...frames.map((f) => ({ type: "input_image", image_url: f, detail: "low" }))],
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`model_${res.status}`);
  const payload = (await res.json()) as { output?: { content?: { type?: string; text?: string }[] }[] };
  const text = (payload.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
  return parseVideoSteps(text);
}
