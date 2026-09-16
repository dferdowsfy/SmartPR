// Voice → Passport: REST STT + Grok extraction into Business Passport fields.
// Browser never sees XAI_API_KEY. Does not invent SSN / EIN / passwords.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getCurrentUser } from "../../../../lib/supabase/server";
import { getPool, isEnabled } from "../../../graph/db";
import { ensureSchema, resolveBusinessUuid } from "../../../graph/store";
import {
  isXaiConfigured,
  requestXaiStt,
  requestXaiText,
  XaiApiError,
  XAI_MODEL,
} from "../../../ai/xai";
import type { BusinessPassportJson } from "../../../forms/engine/businessPassport";
import { passportExtractionPrompt, validatePassportProposals } from "../../../ai/intake/passportExtraction";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 12000;
const PR_KEYTERMS = ["SmartPR", "Puerto Rico", "Hacienda", "Registro de Comerciante", "Departamento de Estado", "EIN", "NAICS", "LLC", "San Juan", "Bayamón", "catastral"];

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

async function assertBusinessAccess(userId: string, businessId: string): Promise<boolean> {
  if (!isEnabled()) return false;
  const pool = getPool();
  if (!pool) return false;
  await ensureSchema();
  const businessUuid = await resolveBusinessUuid(pool, businessId);
  if (!businessUuid) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM businesses b
       LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
      WHERE b.id=$1 AND b.archived=false AND (b.user_id=$2 OR wm.user_id IS NOT NULL)
      LIMIT 1`,
    [businessUuid, userId]
  );
  return Boolean(rows[0]);
}

function keytermsForBusiness(passport: BusinessPassportJson | null | undefined): string[] {
  const terms = [...PR_KEYTERMS];
  const legal = passport?.business?.legalName?.trim();
  const trade = passport?.business?.tradeName?.trim();
  if (legal) terms.push(legal.slice(0, 50));
  if (trade) terms.push(trade.slice(0, 50));
  const muni = passport?.addresses?.municipality?.trim();
  if (muni) terms.push(muni.slice(0, 50));
  return terms.slice(0, 40);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

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

  const businessId = String(form.get("businessId") || "").trim();
  if (!businessId) {
    return Response.json({ error: "businessId is required." }, { status: 400 });
  }

  const allowed = await assertBusinessAccess(user.id, businessId);
  if (!allowed) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const langRaw = String(form.get("language") || form.get("lang") || "en").toLowerCase();
  const lang: "en" | "es" = langRaw.startsWith("es") ? "es" : "en";

  let passportHint: BusinessPassportJson | null = null;
  const passportRaw = form.get("passport");
  if (typeof passportRaw === "string" && passportRaw.trim()) {
    try {
      passportHint = JSON.parse(passportRaw) as BusinessPassportJson;
    } catch {
      passportHint = null;
    }
  }

  const textOnly = String(form.get("text") || "").trim().slice(0, MAX_TRANSCRIPT_CHARS);
  const audio = form.get("audio") || form.get("file");

  let transcript = textOnly;
  let sttDuration: number | undefined;
  let sttLanguage: string | undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    if (!transcript) {
      if (!(audio instanceof Blob) || audio.size === 0) {
        return Response.json(
          { error: "Provide an audio recording or text description." },
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

      const stt = await requestXaiStt({
        file: audio,
        filename,
        language: lang,
        keyterms: keytermsForBusiness(passportHint),
        signal: controller.signal,
      });
      transcript = (stt.text || "").trim().slice(0, MAX_TRANSCRIPT_CHARS);
      sttDuration = stt.duration;
      sttLanguage = stt.language;
    }

    if (!transcript) {
      return Response.json(
        { error: lang === "es" ? "No se detectó habla." : "No speech detected." },
        { status: 422 }
      );
    }

    const text = await requestXaiText({
      input: [
        { role: "system", content: passportExtractionPrompt() },
        {
          role: "user",
          content: `Transcript:\n"""${transcript}"""`,
        },
      ],
      maxOutputTokens: 6500,
      temperature: 0.1,
      signal: controller.signal,
    });

    const parsed = parseJsonObject(text);
    if (!parsed) {
      return Response.json({ error: "Could not parse the AI response." }, { status: 502 });
    }

    const proposals = validatePassportProposals(parsed.proposals, transcript, lang);
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 280)
        : undefined;

    return Response.json({
      transcript,
      summary,
      proposals,
      count: proposals.length,
      ai_model: XAI_MODEL,
      stt: { duration: sttDuration, language: sttLanguage },
    });
  } catch (e) {
    if (e instanceof XaiApiError) {
      const detail = (e.detail || "").trim();
      console.error("[passport/voice] STT xAI error", e.status, detail);
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
      { error: aborted ? "AI request timed out" : "Voice passport request failed" },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
