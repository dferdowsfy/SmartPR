/**
 * SmartPR Voice Phase 3: low-risk project fact updates.
 *
 * Voice may only change facts on an explicit allowlist of CANONICAL keys —
 * the same keys `buildEngineInput()` already reads (KB question writeKeys
 * and project-context keys). There is no parallel voice schema.
 *
 * Flow: propose (validate + confirmation summary) -> caller confirms ->
 * persist canonical fact with provenance -> rerun the authoritative rules
 * engine -> return the before/after requirement diff. Grok never infers
 * requirement changes; it only speaks the engine's returned diff.
 */

import { createHash } from "crypto";
import { KB, buildEngineInput } from "../../app/kb";
import { runRulesEngine, type GeneratedRequirement } from "../../app/rulesEngine";
import { VoiceAuthError, type Db, type VoiceContext } from "./context";
import { logVoiceAudit } from "./audit";

export type FactScope = "business" | "project";
export type FactValueType = "boolean" | "string" | "number";

export interface VoiceEditableFact {
  /** Canonical key — identical to what buildEngineInput reads. */
  key: string;
  scope: FactScope;
  /** Speakable label used in deterministic confirmation summaries. */
  label: string;
  type: FactValueType;
  /** Business-scope facts live in passport_json, except physical_address. */
  column?: "physical_address";
}

/**
 * The ONLY facts voice may propose. Anything else is denied server-side —
 * the model cannot talk its way into editing arbitrary fields.
 */
export const VOICE_EDITABLE_FACTS: Record<string, VoiceEditableFact> = {
  // -- business scope (persisted to businesses.passport_json) --
  alcohol_sold: { key: "alcohol_sold", scope: "business", label: "alcohol will be sold", type: "boolean" },
  alcohol_served: { key: "alcohol_served", scope: "business", label: "alcohol will be served", type: "boolean" },
  food_prepared_on_site: { key: "food_prepared_on_site", scope: "business", label: "food will be prepared on site", type: "boolean" },
  food_sold: { key: "food_sold", scope: "business", label: "food will be sold", type: "boolean" },
  commercial_signage: { key: "commercial_signage", scope: "business", label: "commercial signage will be installed", type: "boolean" },
  renewable_install: { key: "renewable_install", scope: "business", label: "a solar installation is planned", type: "boolean" },
  employees_hired: { key: "employees_hired", scope: "business", label: "employees will be hired", type: "boolean" },
  physical_address: { key: "physical_address", scope: "business", label: "the physical address", type: "string", column: "physical_address" },
  // -- project scope (persisted to matters.facts_json) --
  renovation: { key: "renovation", scope: "project", label: "interior renovation work", type: "boolean" },
  exterior_work: { key: "exterior_work", scope: "project", label: "exterior work", type: "boolean" },
  change_of_use: { key: "change_of_use", scope: "project", label: "a change of use", type: "boolean" },
  new_construction: { key: "new_construction", scope: "project", label: "new construction activity", type: "boolean" },
  scope_of_work: { key: "scope_of_work", scope: "project", label: "the project description", type: "string" },
  employee_count: { key: "employee_count", scope: "project", label: "the number of employees", type: "number" },
};

export function getVoiceEditableFact(key: string): VoiceEditableFact | null {
  return VOICE_EDITABLE_FACTS[key] ?? null;
}

/** Coerce and validate a model-supplied value against the canonical type. */
export function coerceFactValue(
  def: VoiceEditableFact,
  raw: unknown
): boolean | string | number {
  if (def.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const v = raw.trim().toLowerCase();
      if (["true", "yes", "1"].includes(v)) return true;
      if (["false", "no", "0"].includes(v)) return false;
    }
    if (typeof raw === "number") return raw !== 0;
    throw new VoiceAuthError(
      "bad_request",
      `The value for "${def.label}" must be yes or no.`,
      400
    );
  }
  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      throw new VoiceAuthError(
        "bad_request",
        `The value for "${def.label}" must be a number.`,
        400
      );
    }
    return Math.round(n);
  }
  const s = String(raw ?? "").trim();
  if (!s || s.length > 500) {
    throw new VoiceAuthError(
      "bad_request",
      `The value for "${def.label}" must be 1-500 characters.`,
      400
    );
  }
  return s;
}

/** Deterministic confirmation summary — Grok reads this verbatim. */
export function summarizeFactUpdate(
  def: VoiceEditableFact,
  value: boolean | string | number,
  businessName: string,
  matterTitle: string | null
): string {
  const where = matterTitle
    ? `the project "${matterTitle}" for ${businessName}`
    : businessName;
  let change: string;
  if (def.type === "boolean") {
    change = value
      ? `indicate that ${def.label}`
      : `indicate that ${def.label.replace(/^indicate that /, "")} will NOT apply`;
    // Simpler phrasing for the negative case:
    change = value ? `indicate that ${def.label}` : `remove the indication that ${def.label}`;
  } else {
    change = `set ${def.label} to "${value}"`;
  }
  return (
    `You want me to update ${where} to ${change}. ` +
    `This may change your permit requirements. Should I make that change?`
  );
}

interface BusinessFactState {
  passport: Record<string, unknown>;
  municipality: string | null;
  businessType: string | null;
  physicalAddress: string | null;
}

async function loadBusinessFactState(
  db: Db,
  businessId: string
): Promise<BusinessFactState> {
  const { rows } = await db.query<{
    passport_json: Record<string, unknown> | null;
    municipality: string | null;
    business_type: string | null;
    physical_address: string | null;
  }>(
    `SELECT passport_json, municipality, business_type, physical_address
       FROM businesses WHERE id = $1 LIMIT 1`,
    [businessId]
  );
  const row = rows[0];
  if (!row) throw new VoiceAuthError("not_found", "Business not found.", 404);
  return {
    passport: (row.passport_json as Record<string, unknown>) ?? {},
    municipality: row.municipality,
    businessType: row.business_type,
    physicalAddress: row.physical_address,
  };
}

async function loadMatterFacts(
  db: Db,
  matterId: string,
  businessId: string
): Promise<{ title: string; facts: Record<string, unknown> }> {
  const { rows } = await db.query<{ title: string; facts_json: Record<string, unknown> | null }>(
    `SELECT title, facts_json FROM matters WHERE id = $1 AND business_id = $2 LIMIT 1`,
    [matterId, businessId]
  );
  const row = rows[0];
  if (!row) throw new VoiceAuthError("not_found", "Project not found.", 404);
  return { title: row.title, facts: (row.facts_json as Record<string, unknown>) ?? {} };
}

/** Resolve the target matter: explicit id, or the business's latest open matter. */
export async function resolveVoiceMatter(
  db: Db,
  businessId: string,
  matterId?: string | null
): Promise<{ id: string; title: string }> {
  if (matterId) {
    const m = await loadMatterFacts(db, matterId, businessId);
    return { id: matterId, title: m.title };
  }
  const { rows } = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM matters
      WHERE business_id = $1 AND status NOT IN ('ARCHIVED', 'COMPLETED')
      ORDER BY opened_at DESC LIMIT 1`,
    [businessId]
  );
  if (!rows[0]) {
    throw new VoiceAuthError(
      "bad_request",
      "There is no open project for that business. Create a project first.",
      400
    );
  }
  return { id: rows[0].id, title: rows[0].title };
}

export interface RequirementRef {
  document_id: string;
  document_name: string;
  agency: string;
  source_rule_id: string;
}

function toRefs(reqs: GeneratedRequirement[]): RequirementRef[] {
  return reqs.map((r) => ({
    document_id: r.document_id,
    document_name: r.document_name,
    agency: r.agency,
    source_rule_id: r.source_rule_id,
  }));
}

/**
 * Run the authoritative rules engine over the business's persisted facts.
 * This is a refresh, not an intake session: every persisted fact
 * participates (legacy/admissible mode), so the result is the true current
 * requirement set — the diff between two runs is the real delta.
 */
export async function evaluateVoiceRequirements(
  db: Db,
  businessId: string,
  matterId: string | null
): Promise<RequirementRef[]> {
  const state = loadBusinessFactState(db, businessId);
  const matter = matterId ? loadMatterFacts(db, matterId, businessId) : null;
  const [s, m] = await Promise.all([state, matter]);

  const answers: Record<string, unknown> = { ...s.passport, ...(m?.facts ?? {}) };
  const profile = {
    municipality: s.municipality ?? undefined,
    business_type: s.businessType ?? undefined,
    physical_address: s.physicalAddress ?? undefined,
  };
  // Project-context facts in the shape the engine consumes; voice-confirmed
  // facts carry full confidence (provenance is stored separately).
  const projectContext: Record<string, { value: string | number | boolean; confidence: number }> = {};
  if (m) {
    for (const [k, v] of Object.entries(m.facts)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        projectContext[k] = { value: v, confidence: 1 };
      }
    }
  }
  const input = buildEngineInput(profile, answers, {}, { projectContext: projectContext as never });
  const result = runRulesEngine(KB, input);
  return toRefs(result.requirements);
}

export interface RequirementsDiff {
  added: RequirementRef[];
  removed: RequirementRef[];
  changed: RequirementRef[];
}

export function diffRequirements(before: RequirementRef[], after: RequirementRef[]): RequirementsDiff {
  const beforeById = new Map(before.map((r) => [r.document_id, r]));
  const afterById = new Map(after.map((r) => [r.document_id, r]));
  const added = after.filter((r) => !beforeById.has(r.document_id));
  const removed = before.filter((r) => !afterById.has(r.document_id));
  const changed = after.filter((r) => {
    const prev = beforeById.get(r.document_id);
    return !!prev && (prev.source_rule_id !== r.source_rule_id || prev.agency !== r.agency);
  });
  return { added, removed, changed };
}

/**
 * Persist a confirmed fact to its canonical store and record provenance.
 * Only called with the frozen pending-action payload after confirmation.
 */
export async function persistVoiceFact(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  matterId: string | null,
  def: VoiceEditableFact,
  value: boolean | string | number
): Promise<void> {
  if (def.scope === "business") {
    if (def.column === "physical_address") {
      await db.query(`UPDATE businesses SET physical_address = $2 WHERE id = $1`, [
        businessId,
        String(value),
      ]);
    } else {
      await db.query(
        `UPDATE businesses SET passport_json = COALESCE(passport_json, '{}'::jsonb) || $2::jsonb,
                                updated_at = now()
          WHERE id = $1`,
        [businessId, JSON.stringify({ [def.key]: value })]
      );
    }
  } else {
    if (!matterId) {
      throw new VoiceAuthError("bad_request", "A project is required for that fact.", 400);
    }
    await db.query(
      `UPDATE matters SET facts_json = COALESCE(facts_json, '{}'::jsonb) || $3::jsonb,
                          updated_at = now()
        WHERE id = $1 AND business_id = $2`,
      [matterId, businessId, JSON.stringify({ [def.key]: value })]
    );
  }
  // Provenance: source=voice, session id, timestamp, scope. Never mark
  // model inference as user confirmation — this row is only written after
  // an explicit caller confirmation.
  try {
    await db.query(
      `INSERT INTO voice_fact_provenance
         (business_id, matter_id, fact_key, fact_value, source, voice_session_id, user_id)
       VALUES ($1, $2, $3, $4::jsonb, 'voice', $5, $6)`,
      [
        businessId,
        matterId,
        def.key,
        JSON.stringify(value),
        ctx.sessionId,
        ctx.userId,
      ]
    );
  } catch {
    /* provenance table missing (migration not applied) must not break writes */
  }
  await logVoiceAudit(db, {
    userId: ctx.userId,
    action: "fact_changed",
    details: {
      business_id: businessId,
      matter_id: matterId,
      fact_key: def.key,
      fact_scope: def.scope,
      new_value: value,
      // before/after values for regulatory facts where safe — never secrets
    },
  });
}

/** Hash helper for dedupe keys (no secrets involved). */
export function hashForDedupe(parts: Array<string | null | undefined>): string {
  return createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex");
}
