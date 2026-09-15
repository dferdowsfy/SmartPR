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
import {
  PASSPORT_INTAKE_FIELDS,
  type BusinessPassportJson,
} from "../../../forms/engine/businessPassport";
import { ENTITY_TYPE_OPTIONS, FORMATION_STATUS_OPTIONS } from "../../../forms/engine/intake";
import type { IntakeFieldSpec } from "../../../forms/engine/intake";

const MAX_AUDIO_BYTES = 12 * 1024 * 1024; // ~12 MB voice clips
const MAX_TRANSCRIPT_CHARS = 4000;
const MIN_CONFIDENCE = 0.6;

const FORBIDDEN_FIELD_IDS = new Set(["ssn", "password", "passwords", "socialSecurity"]);

/** Keyterms bias STT toward Puerto Rico / SmartPR business vocabulary. */
const PR_KEYTERMS = [
  "SmartPR",
  "Puerto Rico",
  "Hacienda",
  "Registro de Comerciante",
  "Department of State",
  "Departamento de Estado",
  "EIN",
  "NAICS",
  "LLC",
  "corporación",
  "municipio",
  "San Juan",
  "Bayamón",
  "Ponce",
  "Caguas",
  "Mayagüez",
  "Carolina",
  "Guaynabo",
  "Arecibo",
  "catastral",
];

type PassportVoiceProposal = {
  fieldId: string;
  canonicalKey: string;
  label: { en: string; es: string };
  value: unknown;
  confidence: number;
  displayValue: string;
};

function fieldCatalog(): string {
  return PASSPORT_INTAKE_FIELDS.map((f) => {
    const opts =
      f.options && f.options.length
        ? ` :: allowed values = ${f.options.map((o) => o.value).join(" | ")}`
        : "";
    const typeHint =
      f.type === "address"
        ? " :: value = { line1, line2?, cityOrMunicipality, stateOrTerritory?, postalCode, country }"
        : f.type === "number"
          ? " :: value = number"
          : f.type === "checkbox"
            ? " :: value = boolean"
            : f.type === "select"
              ? ""
              : ` :: type=${f.type}`;
    return `- ${f.id} :: ${f.canonicalKey} :: ${f.label.en} / ${f.label.es}${typeHint}${opts}`;
  }).join("\n");
}

function buildExtractPrompt(isEs: boolean): string {
  return `You are SmartPR's Business Passport voice extractor for Puerto Rico businesses.

Given a transcript of the owner describing their business, extract ONLY facts that map to the catalog below.

RULES:
1. Return ONLY valid JSON — no markdown, no commentary.
2. Only use fieldId values from the catalog. Never invent field ids.
3. Only extract facts explicitly stated or strongly implied. Omit unknowns.
4. NEVER invent SSN, EIN, passwords, or registry/merchant numbers. Include EIN or registry/merchant numbers ONLY when the speaker clearly states the digits/value.
5. NEVER invent passwords or security credentials (those fields do not exist — do not invent them).
6. Confidence: explicit 0.90–0.99, strong implication 0.70–0.89, uncertain <0.60 (omit those).
7. For entityType use only: ${ENTITY_TYPE_OPTIONS.map((o) => o.value).join(", ")}.
8. For formationStatus use only: ${FORMATION_STATUS_OPTIONS.map((o) => o.value).join(", ")}.
9. For addresses, return a structured object. Prefer Puerto Rico (PR) as stateOrTerritory and country "US" when implied.
10. Do not invent legal names — only when the speaker names the business.

CATALOG:
${fieldCatalog()}

Return this exact JSON shape:
{
  "summary": "one short sentence",
  "proposals": [
    { "fieldId": "legalName", "value": "...", "confidence": 0.95 }
  ]
}
${isEs ? 'Write "summary" in Spanish. Keep fieldId and JSON keys in English.' : ""}

Return ONLY the JSON.`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = (raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function displayFor(spec: IntakeFieldSpec, value: unknown, lang: "en" | "es"): string {
  if (value === undefined || value === null || value === "") return "";
  if (spec.type === "checkbox") {
    if (value === true) return lang === "es" ? "Sí" : "Yes";
    if (value === false) return lang === "es" ? "No" : "No";
    return "";
  }
  if (spec.type === "address" && value && typeof value === "object") {
    const a = value as Record<string, unknown>;
    return [a.line1, a.line2, a.cityOrMunicipality, a.stateOrTerritory, a.postalCode]
      .filter((p) => Boolean(p && String(p).trim()))
      .join(", ");
  }
  if (spec.type === "select" && spec.options) {
    const match = spec.options.find((o) => o.value === String(value));
    if (match) return (lang === "es" ? match.label.es : match.label.en) || match.label.en;
  }
  return String(value).trim();
}

function normalizeAddress(raw: unknown): Record<string, string> | null {
  if (typeof raw === "string") {
    const line = raw.trim();
    if (!line) return null;
    return {
      line1: line,
      cityOrMunicipality: "",
      postalCode: "",
      country: "US",
      stateOrTerritory: "PR",
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const line1 = typeof o.line1 === "string" ? o.line1.trim() : "";
  if (!line1) return null;
  return {
    line1,
    line2: typeof o.line2 === "string" ? o.line2.trim() : "",
    cityOrMunicipality: typeof o.cityOrMunicipality === "string" ? o.cityOrMunicipality.trim() : "",
    stateOrTerritory:
      typeof o.stateOrTerritory === "string" && o.stateOrTerritory.trim()
        ? o.stateOrTerritory.trim()
        : "PR",
    postalCode: typeof o.postalCode === "string" ? o.postalCode.trim() : "",
    country: typeof o.country === "string" && o.country.trim() ? o.country.trim() : "US",
  };
}

function sanitizeProposals(
  raw: unknown,
  lang: "en" | "es"
): PassportVoiceProposal[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(PASSPORT_INTAKE_FIELDS.map((f) => [f.id, f]));
  const out: PassportVoiceProposal[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const fieldId = typeof row.fieldId === "string" ? row.fieldId.trim() : "";
    if (!fieldId || FORBIDDEN_FIELD_IDS.has(fieldId) || seen.has(fieldId)) continue;
    const spec = byId.get(fieldId);
    if (!spec) continue;

    const confidence =
      typeof row.confidence === "number" && Number.isFinite(row.confidence)
        ? row.confidence
        : 0;
    if (confidence < MIN_CONFIDENCE) continue;

    // Extra guard: never invent EIN / registry / merchant numbers from low signal.
    if (
      (fieldId === "ein" ||
        fieldId === "registryNumber" ||
        fieldId === "merchantRegistrationNumber") &&
      confidence < 0.85
    ) {
      continue;
    }

    let value: unknown = row.value;
    if (spec.type === "address") {
      value = normalizeAddress(value);
      if (!value) continue;
    } else if (spec.type === "number") {
      const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      value = n;
    } else if (spec.type === "checkbox") {
      if (typeof value !== "boolean") continue;
    } else if (spec.type === "select") {
      const allowed = new Set((spec.options || []).map((o) => o.value));
      if (typeof value !== "string" || !allowed.has(value)) continue;
    } else {
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (!text) continue;
      // Reject anything that looks like a password dump or SSN pattern we shouldn't store.
      if (/\bssn\b/i.test(text) && fieldId !== "ein") continue;
      value = text;
    }

    const displayValue = displayFor(spec, value, lang);
    if (!displayValue) continue;

    seen.add(fieldId);
    out.push({
      fieldId,
      canonicalKey: spec.canonicalKey,
      label: spec.label,
      value,
      confidence,
      displayValue,
    });
  }

  return out;
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
        { role: "system", content: buildExtractPrompt(lang === "es") },
        {
          role: "user",
          content: `Transcript:\n"""${transcript}"""`,
        },
      ],
      maxOutputTokens: 1200,
      temperature: 0.1,
      signal: controller.signal,
    });

    const parsed = parseJsonObject(text);
    if (!parsed) {
      return Response.json({ error: "Could not parse the AI response." }, { status: 502 });
    }

    const proposals = sanitizeProposals(parsed.proposals, lang);
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
