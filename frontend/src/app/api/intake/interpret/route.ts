// Server-side natural-language intake interpretation.
//
// Reuses the xAI/Grok setup from api/analyze-document. The browser never sees
// XAI_API_KEY.
//
// SCOPE: this route converts a sentence into EXISTING SmartPR intake values.
// It does NOT decide permits, licenses, or documents — the deterministic rules
// engine remains the sole authority for requirement generation. The model may
// only choose from the candidate ids supplied by the caller (drawn from the
// active knowledge base), and anything outside that set is stripped here before
// the client validates again against the KB.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { clampCandidates, type KbCandidates } from "../../../ai/intake/kbCandidates";
import { BUSINESS_STRUCTURE_VALUES } from "../../../ai/intake/validateInterpretation";
import { passportExtractionPrompt, validatePassportProposals } from "../../../ai/intake/passportExtraction";
import {
  isXaiConfigured,
  requestXaiText,
  XaiApiError,
  XAI_MODEL,
} from "../../../ai/xai";

const MAX_DESCRIPTION_CHARS = 1200;

interface InterpretPayload {
  mode?: "passport";
  description?: string;
  candidates?: KbCandidates;
  lang?: string;
  /** The industry / location-type choices the intake actually offers. */
  allowedIndustries?: string[];
  allowedLocationTypes?: string[];
}

function buildSystemPrompt(
  candidates: KbCandidates,
  isEs: boolean,
  allowedIndustries?: string[],
  allowedLocationTypes?: string[]
): string {
  const businessTypes = candidates.businessTypes
    .map((b) => `- ${b.id} :: ${b.name}`)
    .join("\n") || "- (none)";
  const municipalities = candidates.municipalities.join(", ") || "(none)";
  const questions = candidates.questions
    .map((q) => {
      const opts = q.options && q.options.length ? ` :: options = ${q.options.join(" | ")}` : "";
      return `- ${q.id} :: type=${q.type} :: ${q.question}${opts}`;
    })
    .join("\n") || "- (none)";

  return `You are the SmartPR intake interpretation engine.

Your job is to translate a user's description of a Puerto Rico business into existing SmartPR intake values.

You DO NOT determine permits, licenses, registrations, or required documents.
You DO NOT create regulatory requirements.
A separate deterministic rules engine decides all requirements from the values you extract.

You may ONLY select:
- business type ids from the SmartPR context below
- municipalities from the SmartPR context below
- SmartPR question ids from the SmartPR context below

Never invent ids. If the right option is not listed, omit the field entirely.

Only extract facts that are:
1. explicitly stated by the user, or
2. strongly implied by the statement

CRITICAL — MISSING INFORMATION IS UNKNOWN, NOT FALSE.
If the user does not mention a topic, OMIT that question entirely. Do not return false for it.

Example: "I want to open a restaurant in San Juan."
Do NOT assume alcohol = false, outdoor seating = false, live entertainment = false,
employees = false, or renovations = false. Omit all of them.

Only return false when the user explicitly negates something.
Example: "I will not sell alcohol." -> Q_ALCOHOL_SOLD = false.

CRITICAL — RETURN FACTS, NOT CONSEQUENCES.
SmartPR resolves logical relationships between facts itself, deterministically.
Return the most specific thing the user actually said and STOP there. Do not
also return the answers that follow from it.

- "with 10 employees" -> number_of_employees = 10. Do NOT also return
  Q_EMPLOYEES_HIRED — SmartPR derives that, and derives the size bracket too.
- "3 delivery vans" -> number_of_vehicles = 3. Do NOT also return
  Q_COMMERCIAL_VEHICLES.
- "3 rental units" -> number_of_rental_units = 3.
- "a bar" -> businessType BT_BAR. Do NOT also return the industry, or the
  alcohol questions that being a bar already implies.
- "from my house" -> location_type = the home-based option. Do NOT also return
  Q_HOME_BASED / Q_PHYSICAL_LOCATION / Q_ONLINE_ONLY.

Returning a consequence as well is not fatal — SmartPR reconciles it — but a
consequence that CONTRADICTS the fact it follows from will be discarded.

CONFIDENCE:
- Explicitly stated facts: 0.90–0.99
- Strongly implied facts: 0.70–0.89
- Anything uncertain: below 0.60 (it will be dropped, which is correct)

SMARTPR CONTEXT — BUSINESS TYPES:
${businessTypes}

SMARTPR CONTEXT — MUNICIPALITIES:
${municipalities}

SMARTPR CONTEXT — QUESTIONS:
${questions}

Return ONLY valid JSON (no markdown, no commentary) with this exact structure:
{
  "summary": "one short sentence describing the business",
  "businessType": { "id": "BT_...", "name": "...", "confidence": 0.0 },
  "municipality": { "value": "...", "confidence": 0.0 },
  "profileValues": [ { "key": "industry", "value": "...", "confidence": 0.0 } ],
  "answers": [ { "questionId": "Q_...", "value": true, "confidence": 0.0 } ]
}

Omit "businessType" or "municipality" entirely when unknown. Use an empty array
for "profileValues"/"answers" when nothing is known.

ALLOWED profileValues KEYS (use these exact keys, omit any you cannot determine):
- "industry" :: one of: ${(allowedIndustries || []).join(" | ") || "(not supplied)"}
- "business_structure" :: one of: ${BUSINESS_STRUCTURE_VALUES.join(" | ")}
- "location_type" :: one of: ${(allowedLocationTypes || []).join(" | ") || "(not supplied)"}
- "number_of_employees" :: an integer (extract from phrases like "with 10 employees",
  "a staff of 4", "just me" = 1, "no employees" = 0)
- "number_of_vehicles" :: an integer, for commercial/delivery vehicles the user
  counts ("3 delivery vans" -> 3)
- "number_of_rental_units" :: an integer, for rental units the user counts
  ("an Airbnb with 3 units" -> 3)
- "name" :: the business name ONLY when the user actually names it
  (e.g. "a bar called Luna's" -> "Luna's"). Never invent a name.
- "ein" :: the business's 9-digit US federal Employer Identification Number.
  Return digits only (e.g. "E I N number is 1 5 8 2 5 8 9 6 7 8 9" ->
  "15825896789"). Include ONLY when the speaker clearly states the digits.
  Never invent, and never reformat a different number (phone, SSN) as an EIN.
- "incorporation_date" :: the business formation / incorporation / organization
  date as ISO YYYY-MM-DD (e.g. "Formation date January 1st, 2027" ->
  "2027-01-01"). Only when a real calendar date is stated.
- "merchant_registration_number" :: the Hacienda Registro de Comerciante
  (merchant registration) number, exactly as stated. Only when the speaker
  clearly states it — never invent.
- "physical_address" :: the principal physical address street line as stated
  (e.g. "1 Cavet 8"). Street address only — the municipality stays its own
  fact, never folded into this value.
- "trade_name" :: the "doing business as" / DBA name, ONLY when the speaker
  states one (e.g. 'doing business as "Luna\'s Bar"' -> "Luna's Bar").
- "owner_name" :: the owner's full name, ONLY when the speaker states it
  (e.g. "my name is Jose Rivera" -> "Jose Rivera"). Never invent.
- "email" :: the business email address, ONLY when the speaker clearly states
  it (e.g. "my email is jose at example dot com" -> "jose@example.com").
- "phone" :: the business phone number, ONLY when the speaker clearly states
  the digits. Return digits (and a leading + for country code when stated).
- "naics_code" :: the NAICS industry code, digits only, ONLY when the speaker
  clearly states it (e.g. "NAICS 722511" -> "722511").
- "for_profit_status" :: "for_profit" when the speaker says the business is
  for-profit, "nonprofit" when they say nonprofit. Omit when not stated.

IDENTIFIERS AND DATES ARE COPIED, NEVER CREATED. If the speaker does not
state the digits or the date, omit the key entirely — do not guess.

EXTRACT EVERY FACT THE SENTENCE STATES. If the user states a headcount, a
vehicle or unit count, an entity type, an industry, or a location type, return
it — do not return only the business type and municipality.

Example: "I want to open a bar with 10 employees in Bayamón"
-> businessType BT_BAR, municipality Bayamón,
   profileValues [{ number_of_employees: 10 }], answers [].
   (SmartPR derives the industry, the employee bracket, and that employees will
   be hired — all from those facts.)${
    isEs ? '\n\nWrite the "summary" field in Spanish. Keep all ids and JSON keys exactly as specified.' : ""
  }

Return ONLY the JSON. No other text.`;
}

function parseInterpretation(raw: string): Record<string, unknown> | null {
  const cleaned = (raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Defense in depth: strip any id the model invented that was not offered as a
 * candidate. The client validates again against the full active KB.
 */
function stripUnknownIds(
  data: Record<string, unknown>,
  candidates: KbCandidates
): Record<string, unknown> {
  const typeIds = new Set(candidates.businessTypes.map((b) => b.id));
  const questionIds = new Set(candidates.questions.map((q) => q.id));
  const municipalities = new Set(candidates.municipalities.map((m) => m.toLowerCase()));

  const bt = data.businessType as { id?: unknown } | undefined | null;
  if (bt && (typeof bt.id !== "string" || !typeIds.has(bt.id))) delete data.businessType;

  const muni = data.municipality as { value?: unknown } | undefined | null;
  if (muni && (typeof muni.value !== "string" || !municipalities.has(muni.value.toLowerCase()))) {
    delete data.municipality;
  }

  if (Array.isArray(data.answers)) {
    data.answers = (data.answers as Array<{ questionId?: unknown }>).filter(
      (a) => typeof a?.questionId === "string" && questionIds.has(a.questionId)
    );
  }

  // The model must never emit requirements; drop any such field defensively.
  delete data.requirements;
  delete data.documents;

  return data;
}

export async function POST(request: Request) {
  if (!isXaiConfigured()) {
    return Response.json(
      { error: "XAI_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  let payload: InterpretPayload;
  try {
    payload = (await request.json()) as InterpretPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const passportMode = payload.mode === "passport";
  const limit = passportMode ? 12000 : MAX_DESCRIPTION_CHARS;
  if (typeof payload.description !== "string" || (passportMode && payload.description.length > limit)) {
    return Response.json({ error: `Description must be text of at most ${limit} characters.` }, { status: 400 });
  }
  const description = payload.description.slice(0, limit).trim();
  if (!description) {
    return Response.json({ error: "A business description is required." }, { status: 400 });
  }

  const candidates = clampCandidates(
    payload.candidates ?? { businessTypes: [], municipalities: [], questions: [] }
  );
  const isEs = payload.lang === "es";
  const discoveryPrompt = buildSystemPrompt(candidates, isEs, payload.allowedIndustries, payload.allowedLocationTypes);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const text = await requestXaiText({
      input: [
        {
          role: "system",
          content: passportMode
            ? `${discoveryPrompt}\n\nADDITIONAL PASSPORT MODE:\n${passportExtractionPrompt()}\nFor this request combine both outputs as {"interpretation": <the discovery JSON described above>, "proposals": <the Passport proposals array>}. Passport fields require explicit evidence even when discovery permits inference. Keep discovery and Passport outputs separate. Never use a discovery inference as a Passport fact.`
            : discoveryPrompt,
        },
        { role: "user", content: description },
      ],
      maxOutputTokens: passportMode ? 6500 : 900,
      temperature: 0.1,
      signal: controller.signal,
    });
    const parsed = parseInterpretation(text);
    if (!parsed) {
      return Response.json({ error: "Could not parse the AI response." }, { status: 502 });
    }

    if (passportMode) {
      const discovery = parsed.interpretation && typeof parsed.interpretation === "object" && !Array.isArray(parsed.interpretation)
        ? stripUnknownIds(parsed.interpretation as Record<string, unknown>, candidates) : {};
      // These overlapping facts must go through Passport's stricter validator
      // and conflict review, never the legacy blind-merge path.
      delete discovery.municipality;
      if (Array.isArray(discovery.profileValues)) {
        discovery.profileValues = discovery.profileValues.filter((p) => p && ["industry", "location_type", "number_of_vehicles", "number_of_rental_units"].includes(p.key));
      }
      return Response.json({ interpretation: discovery, proposals: validatePassportProposals(parsed.proposals, description, isEs ? "es" : "en"), ai_model: XAI_MODEL });
    }
    return Response.json({
      interpretation: stripUnknownIds(parsed, candidates),
      ai_model: XAI_MODEL,
    });
  } catch (e) {
    if (e instanceof XaiApiError) {
      return Response.json(
        { error: `xAI error ${e.status}`, detail: e.detail },
        { status: 502 }
      );
    }
    const aborted = e instanceof Error && e.name === "AbortError";
    return Response.json(
      { error: aborted ? "AI request timed out" : "AI request failed" },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
