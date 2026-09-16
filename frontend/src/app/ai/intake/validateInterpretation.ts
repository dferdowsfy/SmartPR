// ============================================================================
// Validate AI intake interpretation against the ACTIVE knowledge base.
//
// The model is never trusted with ids. Everything it returns is checked against
// the same KB the rules engine uses; anything unknown, mistyped, or low
// confidence is discarded. The model NEVER produces requirements — it only
// proposes intake values, and this module decides which of those are safe to
// apply automatically.
// ============================================================================

import type { KnowledgeBase } from "../../rulesEngine.ts";
import {
  QUESTION_KEY_MAP,
  LOCATION_QUESTION_IDS,
  isApplicableQuestionId,
  locationTypeForAnswer,
} from "./questionKeyMap.ts";
import { normalize } from "./kbCandidates.ts";
import { resolveIntakeFacts, type ResolvedFact } from "./relationships.ts";

// --- Confidence policy (Part 7) -------------------------------------------

/** At or above this, populate the field automatically. */
export const AUTO_APPLY_THRESHOLD = 0.85;
/** At or above this (but below auto), offer as a suggestion to confirm. */
export const SUGGEST_THRESHOLD = 0.6;

export type Confidence = "applied" | "suggested" | "discarded";

export function classifyConfidence(confidence: number | undefined): Confidence {
  const c = typeof confidence === "number" ? confidence : 0;
  if (c >= AUTO_APPLY_THRESHOLD) return "applied";
  if (c >= SUGGEST_THRESHOLD) return "suggested";
  return "discarded";
}

// --- Raw model output ------------------------------------------------------

export interface RawInterpretation {
  summary?: unknown;
  businessType?: { id?: unknown; name?: unknown; confidence?: unknown } | null;
  municipality?: { value?: unknown; confidence?: unknown } | null;
  profileValues?: Array<{ key?: unknown; value?: unknown; confidence?: unknown }> | null;
  answers?: Array<{ questionId?: unknown; value?: unknown; confidence?: unknown }> | null;
}

// --- Validated output ------------------------------------------------------

export interface ValidatedAnswer {
  questionId: string;
  question: string;
  value: boolean | string;
  confidence: number;
}

export interface ValidatedProfileValue {
  key: string;
  value: string | number;
  confidence: number;
}

export interface ValidatedInterpretation {
  summary: string;
  businessType?: { id: string; name: string; confidence: number };
  municipality?: { value: string; confidence: number };
  /** Validated profile values, keyed by SmartPR profile field. */
  profileValues: ValidatedProfileValue[];
  answers: ValidatedAnswer[];
  /** Same shapes as above but needing user confirmation (0.60–0.84). */
  suggested: {
    businessType?: { id: string; name: string; confidence: number };
    municipality?: { value: string; confidence: number };
    profileValues: ValidatedProfileValue[];
    answers: ValidatedAnswer[];
  };
  /** Anything rejected, with the reason (useful for debugging/telemetry). */
  discarded: { field: string; reason: string }[];
}

/**
 * Profile fields the interpreter may set, and how each is validated.
 *
 * `option` fields must match one of the app's existing choices; `number` fields
 * are parsed and clamped; `text` fields are free-form (a business name cannot
 * be validated against a list). `ein` must be exactly 9 digits and is stored
 * as XX-XXXXXXX; `date` must be a real calendar date in ISO YYYY-MM-DD form.
 * Anything not listed here is ignored.
 */
const PROFILE_FIELD_KINDS: Record<string, "option" | "number" | "text" | "ein" | "date"> = {
  industry: "option",
  location_type: "option",
  business_structure: "option",
  number_of_employees: "number",
  // Counts the relationship resolver turns into the KB's own select buckets
  // (Q_FLEET_SIZE / Q_RENTAL_UNITS) — see relationshipRegistry.ts.
  number_of_vehicles: "number",
  number_of_rental_units: "number",
  name: "text",
  // Official identifiers the speaker states outright. They seed the Business
  // Passport (EIN, formation date, merchant registration, street address) so
  // they never sit unparsed in the description box.
  ein: "ein",
  incorporation_date: "date",
  merchant_registration_number: "text",
  physical_address: "text",
};

/** Entity/filing types the intake's structure selector offers. */
export const BUSINESS_STRUCTURE_VALUES = [
  "corporation",
  "nonprofit_nonstock_corporation",
  "close_corporation",
  "professional_corporation",
  "foreign_corporation",
  "limited_liability_partnership",
  "llc",
  "sole_proprietorship",
  "partnership",
  "other",
];

/** Upper bound per numeric profile field (guards against a runaway model). */
const NUMBER_FIELD_MAX: Record<string, number> = {
  number_of_employees: 10000,
  number_of_vehicles: 10000,
  number_of_rental_units: 10000,
};
const MAX_EMPLOYEES = NUMBER_FIELD_MAX.number_of_employees;

function asNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Coerce a model answer to the type the KB question declares.
 * Returns `undefined` when the value cannot be represented — the caller then
 * discards it so the normal intake asks the question instead.
 */
export function coerceAnswerValue(
  raw: unknown,
  questionType: string,
  options?: string[]
): boolean | string | undefined {
  if (questionType === "boolean") {
    if (typeof raw === "boolean") return raw;
    const s = asString(raw).toLowerCase();
    if (s === "true" || s === "yes" || s === "si" || s === "sí") return true;
    if (s === "false" || s === "no") return false;
    return undefined;
  }
  // Select-style questions must land on an allowed option.
  const s = asString(raw);
  if (!s) return undefined;
  if (options && options.length > 0) {
    const hit = options.find((o) => normalize(o) === normalize(s));
    return hit ?? undefined;
  }
  return s;
}

export interface ValidateOptions {
  /** Industry names the app offers (validated case-insensitively). */
  allowedIndustries?: string[];
  /** Location types the app offers. */
  allowedLocationTypes?: string[];
}

/**
 * Validate a raw model interpretation against the active KB.
 * Nothing here can create a requirement — only intake values.
 */
export function validateInterpretation(
  raw: RawInterpretation | null | undefined,
  kb: KnowledgeBase,
  options: ValidateOptions = {}
): ValidatedInterpretation {
  const out: ValidatedInterpretation = {
    summary: asString(raw?.summary),
    profileValues: [],
    answers: [],
    suggested: { profileValues: [], answers: [] },
    discarded: [],
  };
  if (!raw || typeof raw !== "object") {
    out.discarded.push({ field: "response", reason: "empty or non-object response" });
    return out;
  }

  const drop = (field: string, reason: string) => out.discarded.push({ field, reason });

  // --- Business type: must exist in the active KB -------------------------
  if (raw.businessType) {
    const id = asString(raw.businessType.id);
    const confidence = asNumber(raw.businessType.confidence);
    const match = (kb.businessTypes || []).find((b) => b.id === id);
    if (!id) {
      drop("businessType", "missing id");
    } else if (!match) {
      drop("businessType", `unknown business type id "${id}"`);
    } else {
      const value = { id: match.id, name: match.name, confidence };
      const band = classifyConfidence(confidence);
      if (band === "applied") out.businessType = value;
      else if (band === "suggested") out.suggested.businessType = value;
      else drop("businessType", `confidence ${confidence} below ${SUGGEST_THRESHOLD}`);
    }
  }

  // --- Municipality: must exist in the active KB --------------------------
  if (raw.municipality) {
    const value = asString(raw.municipality.value);
    const confidence = asNumber(raw.municipality.confidence);
    const match = (kb.municipalities || []).find((m) => normalize(m.name) === normalize(value));
    if (!value) {
      drop("municipality", "missing value");
    } else if (!match) {
      drop("municipality", `unknown municipality "${value}"`);
    } else {
      const v = { value: match.name, confidence };
      const band = classifyConfidence(confidence);
      if (band === "applied") out.municipality = v;
      else if (band === "suggested") out.suggested.municipality = v;
      else drop("municipality", `confidence ${confidence} below ${SUGGEST_THRESHOLD}`);
    }
  }

  // --- Profile values: restricted key set + per-kind validation -----------
  for (const entry of raw.profileValues ?? []) {
    const key = asString(entry?.key);
    const confidence = asNumber(entry?.confidence);
    const kind = PROFILE_FIELD_KINDS[key];
    if (!kind) {
      drop(`profileValues.${key || "?"}`, "key not allowed");
      continue;
    }

    let resolved: string | number;
    if (kind === "number") {
      // "10 employees" must land on the numeric field, not a string.
      // Guard the raw type first: Number(null) and Number("") are both 0, so
      // coercing blindly would turn "unknown" into a confident zero.
      const rawValue = entry?.value;
      const isNumeric =
        typeof rawValue === "number" ||
        (typeof rawValue === "string" && rawValue.trim() !== "" && !Number.isNaN(Number(rawValue)));
      const n = isNumeric ? Math.floor(Number(rawValue)) : NaN;
      const max = NUMBER_FIELD_MAX[key] ?? MAX_EMPLOYEES;
      if (!Number.isFinite(n) || n < 0 || n > max) {
        drop(`profileValues.${key}`, `"${asString(rawValue)}" is not a valid number`);
        continue;
      }
      resolved = n;
    } else if (kind === "ein") {
      // Exactly 9 digits, stored in the canonical XX-XXXXXXX display form.
      // The prompt forbids invention; validation enforces the shape.
      const digits = asString(entry?.value).replace(/\D/g, "");
      if (digits.length !== 9) {
        drop(`profileValues.${key}`, `"${asString(entry?.value)}" is not a 9-digit EIN`);
        continue;
      }
      resolved = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    } else if (kind === "date") {
      // ISO YYYY-MM-DD and a real calendar date (rejects 2027-02-30 etc.).
      const s = asString(entry?.value);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
      const real =
        !!m && !!d &&
        d.getFullYear() === Number(m[1]) &&
        d.getMonth() === Number(m[2]) - 1 &&
        d.getDate() === Number(m[3]);
      if (!real) {
        drop(`profileValues.${key}`, `"${s}" is not a valid YYYY-MM-DD date`);
        continue;
      }
      resolved = s;
    } else {
      const value = asString(entry?.value);
      if (!value) {
        drop(`profileValues.${key}`, "missing value");
        continue;
      }
      if (kind === "option") {
        const allowed =
          key === "industry" ? options.allowedIndustries
          : key === "location_type" ? options.allowedLocationTypes
          : key === "business_structure" ? BUSINESS_STRUCTURE_VALUES
          : undefined;
        if (!allowed || allowed.length === 0) {
          drop(`profileValues.${key}`, "no allowed values configured");
          continue;
        }
        const hit = allowed.find((a) => normalize(a) === normalize(value));
        if (!hit) {
          drop(`profileValues.${key}`, `value "${value}" not in allowed list`);
          continue;
        }
        resolved = hit;
      } else {
        resolved = value;
      }
    }

    const band = classifyConfidence(confidence);
    const record: ValidatedProfileValue = { key, value: resolved, confidence };
    if (band === "applied") out.profileValues.push(record);
    else if (band === "suggested") out.suggested.profileValues.push(record);
    else drop(`profileValues.${key}`, `confidence ${confidence} below ${SUGGEST_THRESHOLD}`);
  }

  // --- Answers: id must exist in KB AND be applicable to the intake -------
  const questionById = new Map((kb.questions || []).map((q) => [q.id, q]));
  const seen = new Set<string>();
  for (const entry of raw.answers ?? []) {
    const questionId = asString(entry?.questionId);
    const confidence = asNumber(entry?.confidence);
    if (!questionId) {
      drop("answers", "missing questionId");
      continue;
    }
    if (seen.has(questionId)) {
      drop(`answers.${questionId}`, "duplicate answer");
      continue;
    }
    const question = questionById.get(questionId);
    if (!question) {
      drop(`answers.${questionId}`, "question id not in knowledge base");
      continue;
    }
    if (!isApplicableQuestionId(questionId)) {
      drop(`answers.${questionId}`, "question is not applicable to the intake");
      continue;
    }
    const value = coerceAnswerValue(entry?.value, question.type, question.options);
    if (value === undefined) {
      drop(`answers.${questionId}`, `value does not match question type "${question.type}"`);
      continue;
    }
    seen.add(questionId);
    const record: ValidatedAnswer = { questionId, question: question.question, value, confidence };
    const band = classifyConfidence(confidence);
    if (band === "applied") out.answers.push(record);
    else if (band === "suggested") out.suggested.answers.push(record);
    else drop(`answers.${questionId}`, `confidence ${confidence} below ${SUGGEST_THRESHOLD}`);
  }

  return out;
}

// --- Turning a validated interpretation into an intake patch ---------------

export interface IntakePatch {
  /** Partial SmartPR business profile (existing field names). */
  profile: Record<string, string | number>;
  /**
   * Discovery answers keyed by the EXISTING legacy answer keys that
   * `buildEngineInput()` reads, so the existing rules engine consumes them
   * with no duplicated logic.
   */
  answers: Record<string, boolean | string>;
  /** Short confirmation chips for the "We understood:" strip. */
  chips: { label: string; detail?: string; questionId?: string }[];
  /**
   * Model answers dropped because a stronger extracted fact makes them
   * impossible (e.g. "10 employees" + "no employees will be hired").
   */
  reconciled: {
    questionId: string;
    question: string;
    modelValue: boolean | string;
    derivedValue: unknown;
    relationshipId?: string;
  }[];
}

/** Human-readable chip text for a profile value. */
function profileChipLabel(pv: ValidatedProfileValue): string {
  const n = Number(pv.value);
  if (pv.key === "number_of_employees") return `${pv.value} ${n === 1 ? "employee" : "employees"}`;
  if (pv.key === "number_of_vehicles") return `${pv.value} ${n === 1 ? "vehicle" : "vehicles"}`;
  if (pv.key === "number_of_rental_units") return `${pv.value} ${n === 1 ? "rental unit" : "rental units"}`;
  if (pv.key === "business_structure") {
    return String(pv.value).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // Official identifiers: confirm capture without flashing the full value.
  if (pv.key === "ein") return `EIN ••••${String(pv.value).slice(-4)}`;
  if (pv.key === "incorporation_date") return `Formed ${formatShortDate(String(pv.value))}`;
  if (pv.key === "merchant_registration_number") return `Merchant reg. ${pv.value}`;
  if (pv.key === "physical_address") {
    const s = String(pv.value);
    return s.length > 34 ? `${s.slice(0, 33)}…` : s;
  }
  return String(pv.value);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-01-01" -> "Jan 1, 2027". Input is already validated as a real date. */
function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = SHORT_MONTHS[Number(m[2]) - 1] ?? m[2];
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export interface IntakePatchOptions {
  /**
   * The ACTIVE knowledge base. Supplying it enables the two relationship-aware
   * behaviours: reconciling model answers that contradict a stronger extracted
   * fact, and dropping chips that merely restate a fact another chip implies.
   * Without it `toIntakePatch` behaves exactly as it did before.
   */
  kb?: KnowledgeBase;
  allowedIndustries?: string[];
}

/**
 * Facts the resolver can derive from the interpretation's NON-question values
 * alone (business type, municipality, headcount, location type, structure).
 *
 * Anything in here is already known without the model answering it, which makes
 * it both the reconciliation baseline and the redundant-chip filter.
 */
function derivableFromExtractedFacts(
  validated: ValidatedInterpretation,
  options: IntakePatchOptions
): Map<string, ResolvedFact> {
  if (!options.kb) return new Map();
  const profile: Record<string, unknown> = {};
  if (validated.businessType) profile.business_type = validated.businessType.name;
  for (const pv of validated.profileValues) profile[pv.key] = pv.value;

  const resolution = resolveIntakeFacts(
    { profile, answers: {}, explicitKeys: Object.keys(profile) },
    { kb: options.kb, allowedIndustries: options.allowedIndustries }
  );

  const derived = new Map<string, ResolvedFact>();
  for (const fact of Object.values(resolution.facts)) {
    if (fact.ref.type === "question" && fact.origin === "derived") derived.set(fact.ref.key, fact);
  }
  return derived;
}

/**
 * Convert the auto-apply portion of a validated interpretation into patches for
 * the EXISTING profile + discovery answers. Suggested (0.60–0.84) values are
 * deliberately excluded — the caller confirms those first.
 *
 * Note what this deliberately does NOT do: it does not write derived answers.
 * `Q_EMPLOYEES_HIRED` is not stored just because a headcount was given — the
 * relationship resolver derives it live from `number_of_employees`, so the fact
 * has exactly one home and can never go stale.
 */
export function toIntakePatch(
  validated: ValidatedInterpretation,
  options: IntakePatchOptions = {}
): IntakePatch {
  const patch: IntakePatch = { profile: {}, answers: {}, chips: [], reconciled: [] };

  if (validated.businessType) {
    patch.profile.business_type = validated.businessType.name;
    patch.chips.push({ label: validated.businessType.name });
  }
  if (validated.municipality) {
    patch.profile.municipality = validated.municipality.value;
    patch.chips.push({ label: validated.municipality.value });
  }
  for (const pv of validated.profileValues) {
    patch.profile[pv.key] = pv.value;
    patch.chips.push({ label: profileChipLabel(pv) });
  }

  const derived = derivableFromExtractedFacts(validated, options);

  for (const ans of validated.answers) {
    // Reconcile: a model answer that contradicts a fact we can derive with
    // certainty from what the user actually stated is impossible state, not a
    // second opinion. Drop it and surface the clash.
    const derivedFact = derived.get(ans.questionId);
    if (derivedFact !== undefined && derivedFact.value !== ans.value) {
      patch.reconciled.push({
        questionId: ans.questionId,
        question: ans.question,
        modelValue: ans.value,
        derivedValue: derivedFact.value,
        relationshipId: derivedFact.relationshipId,
      });
      continue;
    }

    if (LOCATION_QUESTION_IDS.has(ans.questionId)) {
      // Location-derived questions move the profile's location_type instead of
      // a discovery answer, because that is what buildEngineInput() reads.
      const locationType = typeof ans.value === "boolean"
        ? locationTypeForAnswer(ans.questionId, ans.value)
        : null;
      if (locationType && !patch.profile.location_type) patch.profile.location_type = locationType;
      if (ans.value === true && ans.questionId !== "Q_PHYSICAL_LOCATION") {
        patch.chips.push({ label: ans.question, questionId: ans.questionId });
      }
      continue;
    }
    const binding = QUESTION_KEY_MAP[ans.questionId];
    if (!binding) continue;
    patch.answers[binding.writeKey] = ans.value;
    if (ans.value === true) patch.chips.push({ label: ans.question, questionId: ans.questionId });
  }

  // Keep the "We understood:" strip to facts the user would recognise. A chip
  // for "Will alcohol be served?" adds nothing next to a "Bar" chip that
  // already implies it.
  patch.chips = patch.chips.filter((chip) => !chip.questionId || !derived.has(chip.questionId));

  return patch;
}
