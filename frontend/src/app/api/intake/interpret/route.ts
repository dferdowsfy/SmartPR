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
import { validateProjectContext } from "../../../ai/intake/projectContext";
import { combineScenario, interpretScenario, normalizeScenario } from "../../../ai/intake/scenario";
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
  "businessType": { "id": "BT_...", "name": "...", "confidence": 0.0, "evidence": "short quote" },
  "municipality": { "value": "...", "confidence": 0.0, "evidence": "short quote" },
  "profileValues": [ { "key": "industry", "value": "...", "confidence": 0.0, "evidence": "short quote" } ],
  "answers": [ { "questionId": "Q_...", "value": true, "confidence": 0.0, "evidence": "short quote" } ],
  "project_intent": { "value": "existing_business", "confidence": 0.0, "evidence": "short quote" },
  "projectContext": { "<fact key>": { "value": ..., "confidence": 0.0, "evidence": "short quote" } },
  "scenario": { "<section>": { "<fact>": { "value": ..., "source": "explicit", "confidence": 0.0, "evidenceText": "verbatim quote" } } }
}

Omit "businessType" or "municipality" entirely when unknown. Use an empty array
for "profileValues"/"answers" and an empty object for "projectContext" when
nothing is known. Omit "project_intent" when the description does not support
any of the three intents at confidence 0.60 or above.

Every extracted fact MUST carry an "evidence" field: a short verbatim quote
from the user's sentence that supports it (never a quote you invented). When
a fact's confidence is between 0.60 and 0.85 you may also set
"requires_confirmation": true on that entry — the app will fill the value but
visibly mark it as needing confirmation.

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
   be hired — all from those facts.)

PROJECT INTENT — determine what the description is about. Set "project_intent"
to exactly one of:
- "existing_business": the speaker's business already exists and operates
  ("we operate", "our company", "already operating", "our hotel", "our plant").
  Renovating, expanding, or altering an EXISTING commercial building or
  property that is already operating commercially is existing_business —
  the speaker is working on a live operation, not starting from zero.
- "new_business": the speaker is starting a business that does not exist yet
  ("I want to open", "starting a", "planning to launch").
- "project_only": a property or construction project with no business being
  formed or operated by the speaker ("as the property owner", "pre-tenant",
  "before finding tenants", no business described at all).
CONFIDENCE BANDS apply (≥0.85 fill silently; 0.60–0.85 requires_confirmation;
below 0.60 omit the field). A construction project FOR an existing company is
existing_business, NOT project_only — project_only means no business of the
speaker's is involved at all. "We are renovating our existing building" or
"the property was already operating commercially" points to existing_business
even when the speaker never says the words "my business". Never default: when
nothing supports an intent, omit it.

PROJECT CONTEXT — preserve facts about the PROJECT itself, not just the
business. The visible intake fields (business name, municipality, industry,
…) only describe the business; a rich description also states what is being
built, renovated, or operated. Extract those project facts into
"projectContext" as an object keyed by fact key, each with { value,
confidence, evidence }. Use ONLY these fact keys, omit any you cannot
determine:

- "project_type" :: one of: renovation, new_construction, expansion,
  change_of_use, or a short phrase when none fits (e.g. "renovation and expansion").
- "existing_building" :: true when the project alters an already-existing building.
- "new_construction" :: true when the project builds something new (can be true
  alongside "renovation": an expansion adds new construction to an existing building).
- "renovation" :: true when existing space is remodeled, altered, or rehabilitated.
- "expansion" :: true when floor area or capacity is added.
- "change_of_use" :: true when the property's use changes.
- "municipality" :: project municipality when stated.
- "property_type" :: e.g. "commercial building", "warehouse", "industrial facility".
- "existing_use" :: how the property is currently used (e.g. "commercial").
- "proposed_use" :: the intended use after the project (e.g. "warehouse + office").
- "square_footage" :: numeric floor area when stated (e.g. 12000).
- "scope_of_work" :: short summary of the work described.
- "structural_work" / "electrical_work" / "plumbing_work" / "mechanical_work" ::
  true when that trade is part of the work. Omit when not stated — never assume.
- "interior_demolition" :: true when interior demolition is stated.
- "new_walls" :: true when new walls / partitions are stated.
- "layout_changes" :: true when the building layout is modified.
- "exterior_work" :: true when exterior work is stated. Omit when not stated.
- "site_work" :: true when site/parking/grading work is stated. Omit when not stated.
- "occupancy_change" :: true when the occupancy or permitted use changes.
  Omit when the description does not say.
- "business_activity" :: what the business DOES (e.g. "manufacturing"),
  ONLY when the speaker states it.
- "business_is_owner_operator" :: true when the speaker says their business
  owns and operates the project; false when they say someone else does. Omit otherwise.
- "employee_count" :: numeric headcount when stated.
- "estimated_project_value" :: numeric estimated cost when stated.
- "known_permitting_issue" :: short note when the speaker says permitting was
  or is a problem (e.g. "permitting process became a major issue").
- "historical_project_status" :: short note when the speaker says what happened
  to the project (e.g. "project fell through").
- "construction_approvals_required" :: true when the speaker says construction
  or related approvals are/were needed.
- "land_disturbance_acres" :: numeric acres of land disturbed by the project
  (grading, excavation, clearing) when stated. Interior floor area is NOT land
  disturbance — never copy square_footage here. Omit when not stated.
- "grading" / "excavation" :: true when grading or excavation is stated.
  Omit when not stated — never assume.
- "part_of_larger_common_plan" :: true when the project is part of a larger
  common plan of development. Omit when not stated.
- "parking_changes" :: true when parking is added, removed, or reconfigured.
  Omit when not stated.
- "loading_changes" :: true when loading zones or truck access change.
  Omit when not stated.
- "property_tenure" :: "owned" when the speaker owns the property, "leased"
  when they lease it. Omit when not stated — never infer tenure.

SCENARIO — READ THE SITUATION AS A WHOLE, LIKE A PERMITTING INTAKE SPECIALIST.
Before anything else, understand what the speaker is trying to accomplish and
how the facts relate. Do NOT treat words as keywords. A word only means what
its role in the sentence gives it: "warehouse" after "leased" is the existing
property; after "into" it is the proposed use. Return "scenario" as nested
sections with ONLY these facts (omit anything not stated or strongly implied):

business: status ("existing" | "new"), name, entityType, industry, proposedActivity
property: municipality, address, parcel, existingBuilding (bool), existingUse,
  authorizedUse, proposedUse, proposedUseSpecificity ("specific" | "insufficient"),
  squareFeet (number), ownershipStatus ("owned" | "leased")
project: type (array: renovation | new_construction | expansion | demolition |
  change_of_use), renovation, demolition ("none" | "interior" | "partial" | "full"),
  electricalWork, plumbingWork, mechanicalWork, structuralWork, exteriorWork,
  footprintChange, layoutChanges, possibleChangeOfUse, siteCirculationChanges (bools)
operations: activity, employees (number), publicAccess, foodService,
  hazardousMaterials, emissionsEquipment, generator, fuelStorage,
  wastewaterDischarge, childrenPresent (bools)

Each fact: { "value", "source": "explicit" (the user said it) | "inferred"
(strongly implied by the whole scenario), "confidence", "evidenceText": a
VERBATIM quote from the description }. Facts whose quote is not in the
description are discarded.

Rules:
- "New commercial operation", "new operation", "new location", "new site" do
  NOT mean a new business. An existing company opens and renovates locations.
  business.status = "new" ONLY when a new entity or business is being formed or
  started ("creating a new LLC", "starting a business"). "existing" only when the
  speaker's own business already operates ("our existing company"). A third
  party ("a client") says nothing about status — omit it.
- A vague proposed use ("a new commercial operation") is proposedUse
  "commercial operation" with proposedUseSpecificity "insufficient". Never
  invent the activity.
- Change of use: "converting X into Y" (Y different) → possibleChangeOfUse true,
  explicit. "continue using it as X" → false, explicit. "modifications to the
  existing use" → true but "inferred" (possible, NOT confirmed).
- Unknown remains unknown. Do not fill structuralWork, exteriorWork, business
  status, employees, or anything else from what is typical.

Example: "A client has leased an existing 12,000-square-foot warehouse and office
facility in Guaynabo. They plan to renovate the interior for a new commercial
operation, including interior demolition, electrical and plumbing work, office
build-out, and modifications to the existing use."
-> scenario: property { municipality Guaynabo, existingBuilding true,
   existingUse "warehouse and office", squareFeet 12000, ownershipStatus leased,
   proposedUse "commercial operation", proposedUseSpecificity insufficient },
   project { type [renovation, demolition], renovation true, demolition interior,
   electricalWork true, plumbingWork true, layoutChanges true,
   possibleChangeOfUse true (source "inferred") }; business.status OMITTED.

BUSINESS vs PROJECT. Never infer the business's Industry from construction
work. "We own a warehouse and are renovating it" does NOT mean the industry
is Construction — the business may be manufacturing, wholesale distribution,
real estate, or unresolved, while construction is only the regulatory domain
of the project. Only set an industry (or businessType/business_activity) when
the speaker states what the business does.

CONFIDENCE BANDS. >= 0.85: the fact is stated plainly. 0.60–0.85: the fact
is strongly implied but not stated outright — set requires_confirmation true
on that entry. Below 0.60: omit the fact entirely. Unknown remains unknown:
never fill a projectContext fact by guessing, and never copy a business fact
into projectContext (or vice versa) unless the sentence supports it.

Example: "We were planning to renovate an existing commercial building in
Guaynabo to add a new 12,000-square-foot warehouse and office area. The
project included interior demolition, new walls, electrical and plumbing
work, and some changes to the building layout. The property was already
operating commercially. We needed construction and related approvals, but
the permitting process became a major issue and the project eventually fell
through."
-> municipality Guaynabo; project_intent existing_business (confidence 0.80,
   requires_confirmation true — "The property was already operating
   commercially": a live commercial operation being renovated, not a new
   venture); projectContext: project_type "renovation and
   expansion", existing_building true, renovation true, expansion true,
   new_construction true, property_type "commercial building",
   existing_use "commercial", proposed_use "warehouse + office",
   square_footage 12000, scope_of_work "interior demolition, new walls,
   electrical and plumbing work, layout changes", interior_demolition true,
   new_walls true, layout_changes true, electrical_work true,
   plumbing_work true, construction_approvals_required true,
   known_permitting_issue "permitting process became a major issue",
   historical_project_status "project fell through"; structural_work,
   exterior_work, site_work, occupancy_change OMITTED (not stated);
   industry NOT set to Construction.
${
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
      maxOutputTokens: passportMode ? 6500 : 2600,
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
    const stripped = stripUnknownIds(parsed, candidates);
    // Project-context facts are validated defensively: malformed entries are
    // dropped individually and never destroy the rest of the interpretation.
    const { context: projectContext } = validateProjectContext(parsed.projectContext);
    // The model's scenario reading is checked against the text (quotes must
    // be real; guarded conclusions need the right language) and combined
    // with the deterministic reading. Never trusted as-is.
    const { scenario: modelScenario, report: scenarioReport } = normalizeScenario(parsed.scenario, description);
    const scenario = combineScenario(interpretScenario(description), modelScenario);
    return Response.json({
      interpretation: stripped,
      projectContext,
      scenario,
      scenario_report: scenarioReport,
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
