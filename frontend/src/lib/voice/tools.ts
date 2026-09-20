/**
 * Shared SmartPR voice tool services (Phase 2).
 *
 * These are the SAME implementations the Phase 1 v1 routes execute — extracted
 * verbatim into service functions so both the REST voice API and the MCP
 * server call one source of truth. No logic is duplicated in MCP handlers.
 *
 * Every function follows the Phase 1 pipeline: the VoiceContext (user,
 * workspace, role, plan) is derived server-side from the validated voice
 * session. Tool arguments carry only resource identifiers (businessId);
 * identity fields are never accepted from the caller.
 */

import {
  auditedToolCall,
  listAccessibleBusinesses,
  requireBusinessAccess,
  VoiceAuthError,
  type Db,
  type VoiceContext,
} from "./context";
import {
  getBusinessEvidence,
  getBusinessNotifications,
  getBusinessObligations,
  getBusinessReadiness,
} from "../../app/api/voice/_business";
import { sendComplianceEmail } from "../compliance-reminders";
import { incrementVoiceUsage } from "./usage";
import { logVoiceAudit } from "./audit";
import { puertoRicoPack } from "../../app/jurisdictions/pr/index";
import { runRulesEngine, type BusinessStatus } from "../../app/rulesEngine";
import { classifyEngineRequirements } from "../../app/requirementApplicability";

/** Voice email_my_summary only — compliance reminders keep alerts@. */
export const VOICE_SUMMARY_FROM = "SmartPR Recap <recap@getsmartpr.com>";

const MISSING_STATES = new Set(["NONE", "FAILED", "NEEDS_REVIEW"]);

/* ------------------------------------------------------------------ */
/* Anonymous knowledge-graph tool (no voice session)                   */
/* ------------------------------------------------------------------ */

const MAX_GENERAL_REQUIREMENTS = 30;
const MAX_FOLLOW_UP_QUESTIONS = 5;
const MAX_MATCH_CANDIDATES = 5;

function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Match free text against a KB name list: exact (case-insensitive) first,
 * then a single unambiguous substring match. Returns candidates when the
 * match is ambiguous or absent so the agent can ask the caller to clarify —
 * never guess a jurisdiction or business type.
 */
function matchKbName<T extends { name: string }>(
  names: T[],
  raw: string
): { kind: "exact" | "fuzzy"; value: T } | { kind: "candidates"; candidates: string[] } {
  const norm = normalizeName(raw);
  const exact = names.find((n) => normalizeName(n.name) === norm);
  if (exact) return { kind: "exact", value: exact };
  const partials = names.filter(
    (n) => normalizeName(n.name).includes(norm) || norm.includes(normalizeName(n.name))
  );
  if (partials.length === 1) return { kind: "fuzzy", value: partials[0] };
  const starts = names
    .filter((n) => normalizeName(n.name).startsWith(norm))
    .map((n) => n.name);
  const includes = names
    .filter((n) => normalizeName(n.name).includes(norm) && !starts.includes(n.name))
    .map((n) => n.name);
  return { kind: "candidates", candidates: [...starts, ...includes].slice(0, MAX_MATCH_CANDIDATES) };
}

function coerceAnswer(value: unknown): boolean | string | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase();
    if (["yes", "y", "true", "sí", "si"].includes(norm)) return true;
    if (["no", "n", "false"].includes(norm)) return false;
    return value.trim() === "" ? undefined : value.trim();
  }
  return undefined;
}

/**
 * get_general_requirements — anonymous Puerto Rico regulatory lookup.
 *
 * Runs SmartPR's deterministic rules engine over the Puerto Rico knowledge
 * graph for a described business scenario. No voice session, no account, no
 * persisted state: the caller describes a business type (+ municipality),
 * the engine evaluates every rule, and the classifier labels each
 * requirement required / likely_required / conditional / verify_existing.
 *
 * Deliberately stateless: nothing is saved, so there is nothing to leak
 * across callers. Unknown business types return candidates for the agent
 * to clarify — the engine never runs on a guessed type.
 */
export async function toolGetGeneralRequirements(db: Db, args: Record<string, unknown>) {
  void db; // stateless: the engine reads only the bundled knowledge graph
  const kb = puertoRicoPack.kb;

  const businessTypeRaw = typeof args.business_type === "string" ? args.business_type : "";
  if (!businessTypeRaw.trim()) {
    throw new VoiceAuthError("bad_request", "business_type is required.", 400);
  }
  const statusRaw = typeof args.business_status === "string" ? args.business_status : "new";
  const businessStatus: BusinessStatus = statusRaw === "existing" ? "existing" : "new";

  const btMatch = matchKbName(kb.businessTypes, businessTypeRaw);
  if (btMatch.kind === "candidates") {
    return {
      matched: false,
      candidates: btMatch.candidates,
      message:
        "Could not match that business type. Ask the caller which of these is closest, then call again.",
    };
  }

  let municipalityName: string | null = null;
  let municipalityNote: string | null = null;
  const municipalityRaw = typeof args.municipality === "string" ? args.municipality : "";
  if (municipalityRaw.trim()) {
    const mMatch = matchKbName(kb.municipalities, municipalityRaw);
    if (mMatch.kind === "candidates") {
      municipalityNote = `Municipality "${municipalityRaw.trim()}" did not match; proceeding without municipality-specific rules. Closest matches: ${mMatch.candidates.join(", ") || "none"}. Ask the caller to confirm their municipality and call again to sharpen the result.`;
    } else {
      municipalityName = mMatch.value.name;
      if (mMatch.kind === "fuzzy") {
        municipalityNote = `Municipality understood as "${mMatch.value.name}".`;
      }
    }
  }

  // Optional refinement answers: question_id -> answer. Unknown question
  // ids are dropped (reported) so a model hallucination can never feed the
  // engine.
  const rawAnswers =
    args.answers && typeof args.answers === "object" && !Array.isArray(args.answers)
      ? (args.answers as Record<string, unknown>)
      : {};
  const answers: Record<string, boolean | string | undefined> = {};
  const droppedAnswers: string[] = [];
  for (const [qid, val] of Object.entries(rawAnswers)) {
    if (!kb.questions.some((q) => q.id === qid)) {
      droppedAnswers.push(qid);
      continue;
    }
    answers[qid] = coerceAnswer(val);
  }

  const { requirements } = runRulesEngine(kb, {
    municipalityName,
    businessTypeName: btMatch.value.name,
    answers,
    businessStatus,
    // No sessionId: the historical admissibility behavior applies — every
    // supplied fact is usable because there is no cross-session state to
    // protect. Nothing persists, so provenance has nothing to guard.
  });
  const classified = classifyEngineRequirements(requirements, { kb, businessStatus });

  const rows = classified
    .filter((r) => r.applicability !== "not_applicable")
    .slice(0, MAX_GENERAL_REQUIREMENTS)
    .map((r) => ({
      name: r.document_name,
      agency: r.agency,
      posture: r.applicability,
      reason: r.reason,
      missing_facts: r.missingFacts,
    }));

  // Follow-up questions: question_trigger rules for this business type (or
  // universal) whose question the caller hasn't answered yet.
  const answeredIds = new Set(Object.keys(answers));
  const seen = new Set<string>();
  const followUpQuestions: Array<{ id: string; question: string; options: string[] | null }> = [];
  for (const rule of kb.rules) {
    if (followUpQuestions.length >= MAX_FOLLOW_UP_QUESTIONS) break;
    if (rule.rule_type !== "question_trigger" || !rule.question_id) continue;
    if (answeredIds.has(rule.question_id) || seen.has(rule.question_id)) continue;
    if (rule.business_type_id && rule.business_type_id !== btMatch.value.id) continue;
    seen.add(rule.question_id);
    const q = kb.questions.find((qq) => qq.id === rule.question_id);
    if (q) followUpQuestions.push({ id: q.id, question: q.question, options: q.options ?? null });
  }

  return {
    matched: true,
    jurisdiction: "Puerto Rico",
    matched_business_type: btMatch.value.name,
    business_type_match: btMatch.kind,
    matched_municipality: municipalityName,
    municipality_note: municipalityNote,
    business_status: businessStatus,
    engine: {
      rules_evaluated: kb.rules.length,
      requirements_generated: requirements.length,
    },
    total_requirements: classified.filter((r) => r.applicability !== "not_applicable").length,
    requirements: rows,
    follow_up_questions: followUpQuestions,
    dropped_answers: droppedAnswers,
    note: "Produced by SmartPR's deterministic regulatory engine over the Puerto Rico knowledge graph — not model knowledge. Postures: required = verified rule fires; likely_required = heuristic (unverified) rule — confirm with the agency; conditional = depends on an unanswered fact; verify_existing = an operating business should verify it already holds this. Ask 1-2 follow-up questions and call again with answers to sharpen conditional items.",
  };
}

/** get_account_context — minimal authenticated account context for conversation. */
export async function toolGetAccountContext(db: Db, ctx: VoiceContext) {
  return auditedToolCall(db, ctx, "get_account_context", {}, async () => ({
    email: ctx.email,
    workspace_role: ctx.workspaceRole,
    plan: ctx.plan.planId,
    plan_status: ctx.plan.status,
  }));
}

/** list_my_businesses — businesses the caller may access. */
export async function toolListMyBusinesses(db: Db, ctx: VoiceContext) {
  return auditedToolCall(db, ctx, "list_my_businesses", {}, async () => {
    const businesses = await listAccessibleBusinesses(db, ctx);
    return {
      businesses: businesses.map((b) => ({
        id: b.id,
        public_id: b.public_id,
        name: b.name,
        legal_name: b.legal_name,
        business_type: b.business_type,
        municipality: b.municipality,
      })),
    };
  });
}

/** get_business_summary — compact profile + counts for one authorized business. */
export async function toolGetBusinessSummary(db: Db, ctx: VoiceContext, businessId: string) {
  return auditedToolCall(
    db,
    ctx,
    "get_business_summary",
    { business_id: businessId },
    async () => {
      const business = await requireBusinessAccess(db, ctx, businessId);
      const [obligations, evidence] = await Promise.all([
        getBusinessObligations(db, business.id),
        getBusinessEvidence(db, business.id),
      ]);
      const byStatus = new Map<string, number>();
      for (const o of obligations) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
      return {
        business: {
          id: business.id,
          name: business.name,
          legal_name: business.legal_name,
          business_structure: business.business_structure,
          business_type: business.business_type,
          industry: business.industry,
          municipality: business.municipality,
          physical_address: business.physical_address,
        },
        requirement_count: obligations.length,
        requirements_by_status: Object.fromEntries(byStatus),
        overdue_count: byStatus.get("OVERDUE") ?? 0,
        evidence_count: evidence.length,
      };
    }
  );
}

/** get_requirements — authoritative persisted obligations from the deterministic engine. */
export async function toolGetRequirements(db: Db, ctx: VoiceContext, businessId: string) {
  return auditedToolCall(
    db,
    ctx,
    "get_requirements",
    { business_id: businessId },
    async () => {
      const business = await requireBusinessAccess(db, ctx, businessId);
      const obligations = await getBusinessObligations(db, business.id);
      return {
        business_id: business.id,
        business_name: business.name,
        requirements: obligations.map((o) => ({
          id: o.id,
          name: o.name,
          agency: o.agency,
          status: o.status,
          due_date: o.due_date,
          next_action: o.next_action,
        })),
      };
    }
  );
}

/** get_missing_items — obligations still needing evidence or reviewer attention. */
export async function toolGetMissingItems(db: Db, ctx: VoiceContext, businessId: string) {
  return auditedToolCall(
    db,
    ctx,
    "get_missing_items",
    { business_id: businessId },
    async () => {
      const business = await requireBusinessAccess(db, ctx, businessId);
      const obligations = await getBusinessObligations(db, business.id);
      const missing = obligations.filter(
        (o) => MISSING_STATES.has(o.evidence_state) || o.status === "MISSING"
      );
      return {
        business_id: business.id,
        business_name: business.name,
        missing_count: missing.length,
        missing_items: missing.map((o) => ({
          id: o.id,
          name: o.name,
          agency: o.agency,
          evidence_state: o.evidence_state,
          status: o.status,
          due_date: o.due_date,
          next_action: o.next_action,
        })),
      };
    }
  );
}

/** get_readiness — overall readiness plus per-matter scores. */
export async function toolGetReadiness(db: Db, ctx: VoiceContext, businessId: string) {
  return auditedToolCall(
    db,
    ctx,
    "get_readiness",
    { business_id: businessId },
    async () => {
      const business = await requireBusinessAccess(db, ctx, businessId);
      const readiness = await getBusinessReadiness(db, business.id);
      return {
        business_id: business.id,
        business_name: business.name,
        overall_readiness: readiness.overall,
        matters: readiness.matters,
      };
    }
  );
}

/** get_deadlines — upcoming and overdue deadlines plus scheduled notifications. */
export async function toolGetDeadlines(db: Db, ctx: VoiceContext, businessId: string) {
  return auditedToolCall(
    db,
    ctx,
    "get_deadlines",
    { business_id: businessId },
    async () => {
      const business = await requireBusinessAccess(db, ctx, businessId);
      const [obligations, notifications] = await Promise.all([
        getBusinessObligations(db, business.id),
        getBusinessNotifications(db, business.id, ctx.userId),
      ]);
      const dated = obligations.filter((o) => o.due_date);
      const overdue = dated.filter((o) => o.status === "OVERDUE");
      return {
        business_id: business.id,
        business_name: business.name,
        overdue_count: overdue.length,
        deadlines: dated.map((o) => ({
          id: o.id,
          name: o.name,
          agency: o.agency,
          status: o.status,
          due_date: o.due_date,
          next_action: o.next_action,
        })),
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          scheduled_for: n.scheduled_for,
          status: n.status,
          message: n.message,
        })),
      };
    }
  );
}

/** get_evidence_status — evidence locker coverage for the business. */
export async function toolGetEvidenceStatus(db: Db, ctx: VoiceContext, businessId: string) {
  return auditedToolCall(
    db,
    ctx,
    "get_evidence_status",
    { business_id: businessId },
    async () => {
      const business = await requireBusinessAccess(db, ctx, businessId);
      const [obligations, evidence] = await Promise.all([
        getBusinessObligations(db, business.id),
        getBusinessEvidence(db, business.id),
      ]);
      const verified = obligations.filter((o) => o.evidence_state === "VERIFIED").length;
      return {
        business_id: business.id,
        business_name: business.name,
        evidence_count: evidence.length,
        verified_requirements: verified,
        total_requirements: obligations.length,
        coverage: obligations.map((o) => ({
          requirement_id: o.id,
          requirement_name: o.name,
          evidence_state: o.evidence_state,
        })),
        documents: evidence.map((e) => ({
          id: e.id,
          filename: e.filename,
          document_type: e.document_type,
          review_status: e.review_status,
          obligation_name: e.obligation_name,
        })),
      };
    }
  );
}

function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * email_my_summary — emails the caller's SmartPR summary to the VERIFIED
 * account email on file. The recipient is always derived server-side from the
 * validated voice session; no email argument is accepted. Available on all
 * plans (including free).
 */
/** Max length for the agent-written call recap (keeps the email tight). */
export const MAX_CALL_SUMMARY_CHARS = 4000;

/** Human-readable labels for the session-activity fallback recap. */
const CALL_ACTIVITY_LABELS: Record<string, string> = {
  get_account_context: "Reviewed account context",
  list_my_businesses: "Listed your businesses",
  get_business_summary: "Reviewed business summary",
  get_requirements: "Checked requirements",
  get_missing_items: "Checked missing items",
  get_readiness: "Checked filing readiness",
  get_deadlines: "Checked compliance deadlines",
  get_evidence_status: "Checked evidence locker",
  get_general_requirements: "Looked up general requirements",
  generate_deliverable: "Generated a deliverable",
  email_deliverable: "Emailed a deliverable",
  add_note: "Added a note",
  create_draft_project: "Started a draft project",
  propose_project_fact_update: "Proposed a project update",
  confirm_pending_action: "Confirmed a pending action",
  cancel_pending_action: "Cancelled a pending action",
  send_secure_upload_link: "Sent a secure upload link",
  send_secure_action_link: "Sent a secure action link",
};

function prettyToolName(tool: string): string {
  return CALL_ACTIVITY_LABELS[tool] ?? tool.replace(/_/g, " ");
}

interface SessionActivityRow {
  tool_name: string;
  business_id: string | null;
}

/**
 * Deterministic fallback recap: what actually happened during this call,
 * derived from the session's successful tool-call history. This is the
 * fallback when the agent does not supply its own call summary — it never
 * dumps the account.
 */
export async function buildCallActivityRecap(
  db: Db,
  sessionId: string,
  businessId: string | null
): Promise<string[]> {
  let rows: SessionActivityRow[] = [];
  try {
    const res = await db.query<SessionActivityRow>(
      `SELECT tool_name, business_id FROM voice_tool_calls
        WHERE session_id = $1 AND success = true
          AND tool_name NOT IN ('email_my_summary', 'verify_voice_pin')
        ORDER BY created_at ASC`,
      [sessionId]
    );
    rows = res.rows;
  } catch {
    rows = [];
  }
  // Resolve business names best-effort (text comparison: ids may be UUIDs
  // or opaque test ids; never let a cast failure break the recap).
  const ids = [...new Set(rows.map((r) => r.business_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length) {
    try {
      const biz = await db.query<{ id: string; name: string }>(
        `SELECT id::text AS id, name FROM businesses WHERE id::text = ANY($1)`,
        [ids]
      );
      for (const b of biz.rows) names.set(b.id, b.name);
    } catch {
      // fall through with no names
    }
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of rows) {
    if (businessId && r.business_id && r.business_id !== businessId) continue;
    const key = `${r.tool_name}|${r.business_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bizName = r.business_id ? names.get(r.business_id) : undefined;
    lines.push(`- ${prettyToolName(r.tool_name)}${bizName ? ` for ${bizName}` : ""}`);
  }
  return lines;
}

export async function toolEmailMySummary(
  db: Db,
  ctx: VoiceContext,
  businessId: string | null,
  /** Agent-written recap of what THIS CALL was about (preferred). */
  callSummary: string | null
) {
  const recipient = ctx.email;
  if (!recipient || !recipient.includes("@")) {
    throw new VoiceAuthError(
      "no_verified_email",
      "No verified email is on file for this account.",
      422
    );
  }
  const summary = callSummary?.trim().slice(0, MAX_CALL_SUMMARY_CHARS) || null;
  return auditedToolCall(
    db,
    ctx,
    "email_my_summary",
    { business_id: businessId, has_call_summary: !!summary },
    async () => {
      let subject: string;
      let text: string;
      let html: string;
      if (summary) {
        // Primary path: the agent recaps what this call was about. The
        // agent held the conversation, so it is the only party that can
        // truthfully summarize it.
        subject = "Your SmartPR call recap";
        text = `${summary}\n\nSent from your SmartPR voice call.`;
        html =
          summary
            .split(/\n{2,}/)
            .map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`)
            .join("") +
          `<p style="color:#666;font-size:12px">Sent from your SmartPR voice call.</p>`;
      } else {
        // Fallback: deterministic recap of what actually happened on this
        // call, from the session's tool-call history. Never the account dump.
        const lines = await buildCallActivityRecap(db, ctx.sessionId, businessId);
        const body = lines.length
          ? `Here's what happened on your SmartPR call:\n\n${lines.join("\n")}`
          : "We didn't get to any account actions on this SmartPR call.";
        subject = "Your SmartPR call recap";
        text = `${body}\n\nSent from your SmartPR voice call.`;
        html =
          `<p>${esc(body).replace(/\n/g, "<br/>")}</p>` +
          `<p style="color:#666;font-size:12px">Sent from your SmartPR voice call.</p>`;
      }

      const delivered = await sendComplianceEmail(recipient, subject, text, html, VOICE_SUMMARY_FROM, "voice_recap");
      if (!delivered) {
        throw new VoiceAuthError("delivery_failed", "The summary email could not be delivered.", 502);
      }
      await incrementVoiceUsage(db, ctx.userId, "emails_sent", 1);
      await logVoiceAudit(db, {
        userId: ctx.userId,
        action: "email_sent",
        details: { scope: "call_recap", business_id: businessId, to_domain: recipient.split("@")[1] },
      });
      return { sent: true };
    }
  );
}

/* ==========================================================================
 * Phase 3: authenticated action tools.
 *
 * Same rules as Phase 2, plus:
 * - every write is classified server-side by lib/voice/policy.ts; the model
 *   never supplies a classification
 * - writes that mutate state require an explicit caller confirmation via a
 *   server-stored pending action (opaque pendingActionId); the model only
 *   ever reads the deterministic confirmation summary
 * - confirmation executes the frozen server-stored payload — nothing from
 *   the confirmation utterance is merged into it
 * ========================================================================== */

import { logVoiceAudit as logAudit3 } from "./audit";
import { evaluateVoiceAction, classifySensitiveAction } from "./policy";
import {
  createPendingAction,
  confirmPendingAction,
  cancelPendingAction as cancelPending,
  type PendingActionRow,
} from "./pendingActions";
import {
  getVoiceEditableFact,
  coerceFactValue,
  summarizeFactUpdate,
  resolveVoiceMatter,
  evaluateVoiceRequirements,
  diffRequirements,
  persistVoiceFact,
} from "./facts";
import { createSecureLink } from "./secureLinks";
import {
  generateVoiceDeliverable,
  VOICE_DELIVERABLE_TYPES,
  type VoiceDeliverableType,
} from "./deliverables";
import { createMatterRecord } from "../matters";
import { projectRequirementsToObligations } from "../../app/graph/store";

const MATTER_LABEL: Record<string, string> = {
  NEW_BUSINESS_FORMATION: "new business formation",
  ANNUAL_REPORT: "annual report",
  ANNUAL_FEE: "annual fee",
  PERMISO_UNICO_RENEWAL: "permiso único renewal",
  HEALTH_LICENSE_RENEWAL: "health license renewal",
  MUNICIPAL_LICENSE_RENEWAL: "municipal license renewal",
  CHANGE_OF_ADDRESS: "change of address",
  CHANGE_OF_OWNER: "change of owner",
  SECOND_LOCATION: "second location",
  PERMIT_MODIFICATION: "permit modification",
  OTHER: "project",
};

/* ---------------- create_draft_project ---------------- */

/** create_draft_project — propose only; nothing is persisted until confirmed. */
export async function toolCreateDraftProject(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  projectType: string,
  description?: string | null,
  municipality?: string | null
) {
  return auditedToolCall(
    db,
    ctx,
    "create_draft_project",
    { business_id: businessId },
    async () => {
      const decision = evaluateVoiceAction({ action: "create_draft_project", ctx });
      if (!decision.allowed) {
        throw new VoiceAuthError("forbidden", decision.message ?? "Not permitted by voice.", 403);
      }
      const business = await requireBusinessAccess(db, ctx, businessId);
      const label = MATTER_LABEL[projectType] ?? "project";
      const desc = (description ?? "").trim().slice(0, 500);
      const muni = (municipality ?? "").trim().slice(0, 120);
      const summary =
        `You want me to create a ${label} project for ${business.name}` +
        (desc ? ` — "${desc}"` : "") +
        (muni ? ` in ${muni}` : "") +
        `. It will be saved as a draft. Is that correct?`;
      const pending = await createPendingAction(db, {
        voiceSessionId: ctx.sessionId,
        ctx,
        actionType: "create_draft_project",
        businessId: business.id,
        payload: { projectType, description: desc || null, municipality: muni || null },
        confirmationSummary: summary,
      });
      return {
        status: "pending_confirmation",
        pending_action_id: pending.pendingActionId,
        confirmation_summary: pending.confirmationSummary,
        expires_at: pending.expiresAt,
      };
    }
  );
}

/* ---------------- propose_project_fact_update ---------------- */

/** propose_project_fact_update — validate the canonical key, then propose. */
export async function toolProposeProjectFactUpdate(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  factKey: string,
  factValue: unknown,
  matterId?: string | null
) {
  return auditedToolCall(
    db,
    ctx,
    "propose_project_fact_update",
    { business_id: businessId, fact_key: factKey },
    async () => {
      const decision = evaluateVoiceAction({ action: "update_project_fact", ctx });
      if (!decision.allowed) {
        throw new VoiceAuthError("forbidden", decision.message ?? "Not permitted by voice.", 403);
      }
      const def = getVoiceEditableFact(factKey);
      if (!def) {
        throw new VoiceAuthError(
          "bad_request",
          "That field cannot be changed by voice. Sensitive changes need a secure web link instead.",
          400
        );
      }
      const business = await requireBusinessAccess(db, ctx, businessId);
      const value = coerceFactValue(def, factValue);
      let matter: { id: string; title: string } | null = null;
      if (def.scope === "project") {
        matter = await resolveVoiceMatter(db, business.id, matterId);
      }
      const summary = summarizeFactUpdate(def, value, business.name, matter?.title ?? null);
      const pending = await createPendingAction(db, {
        voiceSessionId: ctx.sessionId,
        ctx,
        actionType: "update_project_fact",
        businessId: business.id,
        matterId: matter?.id ?? null,
        payload: { factKey: def.key, factValue: value, matterId: matter?.id ?? null },
        confirmationSummary: summary,
      });
      return {
        status: "pending_confirmation",
        pending_action_id: pending.pendingActionId,
        confirmation_summary: pending.confirmationSummary,
        expires_at: pending.expiresAt,
        may_change_requirements: true,
      };
    }
  );
}

/* ---------------- confirm / cancel pending actions ---------------- */

/**
 * Execute the frozen server-stored payload for the pending action's type.
 * Never receives model input — only the stored row.
 */
async function acquireMatterClient(db: Db): Promise<import("pg").PoolClient> {
  const maybePool = db as unknown as { connect?: () => Promise<import("pg").PoolClient> };
  if (typeof maybePool.connect === "function") {
    return maybePool.connect();
  }
  // Already a client (or a test double): use it directly.
  return db as import("pg").PoolClient;
}

function releaseMatterClient(db: Db, client: import("pg").PoolClient): void {
  const maybePool = db as unknown as { connect?: () => Promise<import("pg").PoolClient> };
  if (typeof maybePool.connect === "function" && typeof client.release === "function") {
    client.release();
  }
}

async function executePendingAction(
  db: Db,
  ctx: VoiceContext,
  action: PendingActionRow
): Promise<Record<string, unknown>> {
  const p = action.payload_json;
  switch (action.action_type) {
    case "create_draft_project": {
      // Use the caller's own database handle (Pool or PoolClient) — never a
      // hidden global — so the write stays inside the request's transaction
      // scope and stays testable.
      const client = await acquireMatterClient(db);
      try {
        await client.query("BEGIN");
        const created = await createMatterRecord(client, {
          businessId: action.business_id as string,
          workspaceId: action.workspace_id,
          userId: action.user_id,
          matterType: typeof p.projectType === "string" ? p.projectType : "OTHER",
          title: typeof p.description === "string" && p.description ? (p.description as string).slice(0, 160) : null,
          sourceReference: "voice",
        });
        await client.query("COMMIT");
        await logAudit3(db, {
          userId: ctx.userId,
          action: "project_created",
          details: {
            business_id: action.business_id,
            matter_id: created.matterId,
            matter_type: created.matterType,
            source: "voice",
          },
        });
        return {
          matter_id: created.matterId,
          matter_type: created.matterType,
          title: created.title,
          matter_status: "DRAFT",
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        releaseMatterClient(db, client);
      }
    }
    case "update_project_fact": {
      const def = getVoiceEditableFact(String(p.factKey));
      if (!def) throw new VoiceAuthError("bad_request", "Stored fact proposal is invalid.", 400);
      const businessId = action.business_id as string;
      const mId = typeof p.matterId === "string" ? p.matterId : null;
      const before = await evaluateVoiceRequirements(db, businessId, mId);
      await persistVoiceFact(db, ctx, businessId, mId, def, p.factValue as boolean | string | number);
      const after = await evaluateVoiceRequirements(db, businessId, mId);
      const diff = diffRequirements(before, after);
      // Project the recalculated requirements into the authoritative
      // obligation store through the SAME projection the intake flow uses,
      // so voice reads (get_requirements / get_missing_items / get_readiness)
      // and the web UI see the identical requirement set.
      let projectionMatterId = mId;
      if (!projectionMatterId) {
        try {
          projectionMatterId = (await resolveVoiceMatter(db, businessId, null)).id;
        } catch {
          projectionMatterId = null;
        }
      }
      if (projectionMatterId) {
        const oClient = await acquireMatterClient(db);
        try {
          await oClient.query("BEGIN");
          await projectRequirementsToObligations(oClient, {
            businessId,
            matterId: projectionMatterId,
            userId: ctx.userId,
            requirements: after.map((r) => ({
              document_id: r.document_id,
              name: r.document_name,
              agency: r.agency,
              source_rule: r.source_rule_id,
            })),
          });
          await oClient.query("COMMIT");
        } catch (err) {
          await oClient.query("ROLLBACK").catch(() => undefined);
          throw err;
        } finally {
          releaseMatterClient(db, oClient);
        }
      }
      await logAudit3(db, {
        userId: ctx.userId,
        action: "requirements_recalculated",
        details: {
          business_id: businessId,
          matter_id: mId,
          fact_key: def.key,
          added: diff.added.length,
          removed: diff.removed.length,
          changed: diff.changed.length,
          obligations_projected: Boolean(projectionMatterId),
        },
      });
      return {
        fact_key: def.key,
        new_value: p.factValue,
        requirements_added: diff.added.map((r) => ({ name: r.document_name, agency: r.agency })),
        requirements_removed: diff.removed.map((r) => ({ name: r.document_name, agency: r.agency })),
        requirements_changed: diff.changed.map((r) => ({ name: r.document_name, agency: r.agency })),
      };
    }
    case "add_note": {
      const noteText = String(p.noteText ?? "").trim();
      if (!noteText) throw new VoiceAuthError("bad_request", "Stored note is empty.", 400);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO business_notes (id, business_id, workspace_id, user_id, matter_id, note_text, source)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'voice') RETURNING id`,
        [action.business_id, action.workspace_id, action.user_id, action.matter_id, noteText]
      );
      await logAudit3(db, {
        userId: ctx.userId,
        action: "note_added",
        details: { business_id: action.business_id, matter_id: action.matter_id, note_id: rows[0].id },
      });
      return { note_id: rows[0].id };
    }
    default:
      throw new VoiceAuthError("bad_request", "Unknown pending action type.", 400);
  }
}

/** confirm_pending_action — the ONLY write path; ambiguous "yes" never reaches here. */
export async function toolConfirmPendingAction(
  db: Db,
  ctx: VoiceContext,
  pendingActionId: string
) {
  return auditedToolCall(
    db,
    ctx,
    "confirm_pending_action",
    {},
    async () => {
      const result = await confirmPendingAction(db, ctx, pendingActionId, executePendingAction);
      if (result.alreadyExecuted) {
        return { status: "already_confirmed", executed: true };
      }
      return { status: "confirmed", executed: true, ...(result.result ?? {}) };
    }
  );
}

/** cancel_pending_action — settle a pending proposal without executing it. */
export async function toolCancelPendingAction(
  db: Db,
  ctx: VoiceContext,
  pendingActionId: string
) {
  return auditedToolCall(db, ctx, "cancel_pending_action", {}, async () => {
    const { cancelled } = await cancelPending(db, ctx, pendingActionId);
    return { status: cancelled ? "cancelled" : "no_longer_pending" };
  });
}

/* ---------------- send_secure_upload_link ---------------- */

/** send_secure_upload_link — emailed ONLY to the verified account email. */
export async function toolSendSecureUploadLink(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  obligationId?: string | null
) {
  return auditedToolCall(
    db,
    ctx,
    "send_secure_upload_link",
    { business_id: businessId },
    async () => {
      const decision = evaluateVoiceAction({ action: "send_secure_upload_link", ctx });
      if (!decision.allowed) {
        throw new VoiceAuthError("forbidden", decision.message ?? "Not permitted by voice.", 403);
      }
      const business = await requireBusinessAccess(db, ctx, businessId);
      let obligation: { id: string; name: string } | null = null;
      if (obligationId) {
        const { rows } = await db.query<{ id: string; name: string }>(
          `SELECT o.id, o.name
             FROM obligations o
            WHERE o.id = $1 AND o.business_id = $2 LIMIT 1`,
          [obligationId, business.id]
        );
        if (!rows[0]) {
          throw new VoiceAuthError("not_found", "That requirement was not found for this business.", 404);
        }
        obligation = { id: rows[0].id, name: rows[0].name };
      }
      const label = obligation
        ? `upload evidence for ${obligation.name}`
        : `upload evidence for ${business.name}`;
      const link = await createSecureLink(db, {
        ctx,
        purpose: "upload_evidence",
        businessId: business.id,
        obligationId: obligation?.id ?? null,
        label,
      });
      return {
        status: "link_sent",
        emailed: link.emailed,
        emailed_to: "your verified account email",
        expires_at: link.expiresAt,
        for: label,
      };
    }
  );
}

/* ---------------- generate_deliverable ---------------- */

/** generate_deliverable — plan-gated; structured missing-data instead of hallucinations. */
export async function toolGenerateDeliverable(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  deliverableType: string
) {
  return auditedToolCall(
    db,
    ctx,
    "generate_deliverable",
    { business_id: businessId },
    async () => {
      const type = (VOICE_DELIVERABLE_TYPES as readonly string[]).includes(deliverableType)
        ? (deliverableType as VoiceDeliverableType)
        : null;
      if (!type) {
        throw new VoiceAuthError(
          "bad_request",
          "Available deliverables are: readiness report and requirements summary.",
          400
        );
      }
      const business = await requireBusinessAccess(db, ctx, businessId);
      const created = await generateVoiceDeliverable(db, ctx, {
        id: business.id,
        name: business.name,
        municipality: (business as { municipality?: string | null }).municipality ?? null,
      }, type);
      return {
        status: created.deduped ? "already_generated" : "generated",
        deliverable_id: created.deliverableId,
        filename: created.filename,
        kind: created.kind,
        size_bytes: created.sizeBytes,
        generated_at: created.generatedAt,
      };
    }
  );
}

/* ---------------- email_deliverable ---------------- */

/** email_deliverable — ONLY to the verified account email; never caller-supplied. */
export async function toolEmailDeliverable(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  deliverableId: string
) {
  return auditedToolCall(
    db,
    ctx,
    "email_deliverable",
    { business_id: businessId },
    async () => {
      const decision = evaluateVoiceAction({ action: "email_deliverable", ctx });
      if (!decision.allowed) {
        throw new VoiceAuthError("forbidden", decision.message ?? "Not permitted by voice.", 403);
      }
      const business = await requireBusinessAccess(db, ctx, businessId);
      const { rows } = await db.query<{ id: string; filename: string; kind: string }>(
        `SELECT id, filename, kind FROM deliverables
          WHERE id = $1 AND user_id = $2 AND business_id = $3 LIMIT 1`,
        [deliverableId, ctx.userId, business.id]
      );
      const deliverable = rows[0];
      if (!deliverable) {
        throw new VoiceAuthError(
          "not_found",
          "That deliverable was not found for this business.",
          404
        );
      }
      const link = await createSecureLink(db, {
        ctx,
        purpose: "secure_action",
        businessId: business.id,
        actionType: "download_deliverable",
        label: `download ${deliverable.filename}`,
        payload: { deliverable_id: deliverable.id },
        ttlMinutes: 7 * 24 * 60,
        maxUses: 10,
      });
      return {
        status: "link_sent",
        emailed: link.emailed,
        emailed_to: "your verified account email",
        deliverable_id: deliverable.id,
        filename: deliverable.filename,
      };
    }
  );
}

/* ---------------- add_note ---------------- */

/** add_note — informational only; requires confirmation; never alters regulatory facts. */
export async function toolAddNote(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  noteText: string,
  matterId?: string | null
) {
  return auditedToolCall(
    db,
    ctx,
    "add_note",
    { business_id: businessId },
    async () => {
      const decision = evaluateVoiceAction({ action: "add_note", ctx });
      if (!decision.allowed) {
        throw new VoiceAuthError("forbidden", decision.message ?? "Not permitted by voice.", 403);
      }
      const text = (noteText ?? "").trim();
      if (!text || text.length > 2000) {
        throw new VoiceAuthError(
          "bad_request",
          "The note must be between 1 and 2000 characters.",
          400
        );
      }
      const business = await requireBusinessAccess(db, ctx, businessId);
      let matter: { id: string; title: string } | null = null;
      if (matterId) {
        matter = await resolveVoiceMatter(db, business.id, matterId);
      }
      const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      const summary =
        `You want me to save this note for ${business.name}` +
        (matter ? `, project "${matter.title}"` : "") +
        `: "${preview}"` +
        `. Notes are informational only and will not change your permit requirements. Is that correct?`;
      const pending = await createPendingAction(db, {
        voiceSessionId: ctx.sessionId,
        ctx,
        actionType: "add_note",
        businessId: business.id,
        matterId: matter?.id ?? null,
        payload: { noteText: text, matterId: matter?.id ?? null },
        confirmationSummary: summary,
      });
      return {
        status: "pending_confirmation",
        pending_action_id: pending.pendingActionId,
        confirmation_summary: pending.confirmationSummary,
        expires_at: pending.expiresAt,
      };
    }
  );
}

/* ---------------- send_secure_action_link ---------------- */

/**
 * send_secure_action_link — for prohibited voice actions (§8): prepare the
 * action context server-side and email a secure authenticated link. Nothing
 * sensitive executes over voice.
 */
export async function toolSendSecureActionLink(
  db: Db,
  ctx: VoiceContext,
  businessId: string,
  actionType: string
) {
  return auditedToolCall(
    db,
    ctx,
    "send_secure_action_link",
    { business_id: businessId },
    async () => {
      const { prohibited, linkable } = classifySensitiveAction(actionType);
      if (!prohibited || !linkable) {
        throw new VoiceAuthError(
          "bad_request",
          "That action cannot be prepared from a voice call.",
          400
        );
      }
      const business = await requireBusinessAccess(db, ctx, businessId);
      const label = actionType.trim().toLowerCase().replace(/_/g, " ");
      const link = await createSecureLink(db, {
        ctx,
        purpose: "secure_action",
        businessId: business.id,
        actionType: actionType.trim().toLowerCase(),
        label: `${label} for ${business.name}`,
      });
      return {
        status: "link_sent",
        emailed: link.emailed,
        emailed_to: "your verified account email",
        expires_at: link.expiresAt,
        action: label,
      };
    }
  );
}
