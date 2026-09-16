// Intake voice: REST STT only. No businessId required — works before business
// creation (guest or signed-in). Transcript is fed into /api/intake/interpret
// on the client. Browser never sees XAI_API_KEY.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  isXaiConfigured,
  requestXaiStt,
  XaiApiError,
} from "../../../ai/xai";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 12000; // Full multi-field Passport dictation.

/** Keyterms bias STT toward Puerto Rico / SmartPR business vocabulary. */
const PR_KEYTERMS = [
  "SmartPR",
  "Puerto Rico",
  "San Juan",
  "Bayamón",
  "Ponce",
  "Caguas",
  "Mayagüez",
  "Carolina",
  "Guaynabo",
  "Arecibo",
  "restaurante",
  "restaurant",
  "LLC",
  "corporación",
  "municipio",
  "bar",
  "café",
  "clínica",
  "clinic",
  "retail",
];

export async function POST(request: Request) {
  if (!isXaiConfigured()) {
    return Response.json(
      { error: "XAI_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const langRaw = String(form.get("language") || form.get("lang") || "en").toLowerCase();
  const lang: "en" | "es" = langRaw.startsWith("es") ? "es" : "en";

  const audio = form.get("audio") || form.get("file");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json(
      { error: lang === "es" ? "Se necesita una grabación de audio." : "An audio recording is required." },
      { status: 400 }
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio file is too large." }, { status: 413 });
  }

  const filename =
    audio instanceof File && audio.name
      ? audio.name
      : audio.type.includes("ogg")
        ? "audio.ogg"
        : audio.type.includes("mp4") || audio.type.includes("m4a")
          ? "audio.m4a"
          : "audio.webm";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const stt = await requestXaiStt({
      file: audio,
      filename,
      language: lang,
      keyterms: PR_KEYTERMS,
      signal: controller.signal,
    });
    const transcript = (stt.text || "").trim();
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      return Response.json({ error: lang === "es" ? "La grabación es demasiado larga. Divídala en partes más cortas." : "The recording is too long. Please split it into shorter parts." }, { status: 413 });
    }

    if (!transcript) {
      return Response.json(
        { error: lang === "es" ? "No se detectó habla." : "No speech detected." },
        { status: 422 }
      );
    }

    return Response.json({
      transcript,
      stt: { duration: stt.duration, language: stt.language },
    });
  } catch (e) {
    if (e instanceof XaiApiError) {
      const detail = (e.detail || "").trim();
      console.error("[intake/voice] STT xAI error", e.status, detail);
      return Response.json(
        {
          error: detail
            ? `xAI STT error ${e.status}: ${detail.slice(0, 400)}`
            : `xAI STT error ${e.status}`,
          detail: detail || undefined,
        },
        { status: 502 }
      );
    }
    const aborted = e instanceof Error && e.name === "AbortError";
    return Response.json(
      { error: aborted ? "STT request timed out" : "Intake voice request failed" },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
