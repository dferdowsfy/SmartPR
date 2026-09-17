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

const MISSING_STATES = new Set(["NONE", "FAILED", "NEEDS_REVIEW"]);

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
export async function toolEmailMySummary(
  db: Db,
  ctx: VoiceContext,
  businessId: string | null
) {
  const recipient = ctx.email;
  if (!recipient || !recipient.includes("@")) {
    throw new VoiceAuthError(
      "no_verified_email",
      "No verified email is on file for this account.",
      422
    );
  }
  return auditedToolCall(
    db,
    ctx,
    "email_my_summary",
    { business_id: businessId },
    async () => {
      const businesses = businessId
        ? [await requireBusinessAccess(db, ctx, businessId)]
        : await listAccessibleBusinesses(db, ctx);

      const lines: string[] = [];
      const htmlParts: string[] = [];
      for (const business of businesses) {
        const [obligations, readiness] = await Promise.all([
          getBusinessObligations(db, business.id),
          getBusinessReadiness(db, business.id),
        ]);
        const overdue = obligations.filter((o) => o.status === "OVERDUE");
        const missing = obligations.filter((o) => MISSING_STATES.has(o.evidence_state));
        lines.push(
          `${business.name} (${business.municipality || "Puerto Rico"})`,
          `  Requirements: ${obligations.length} | Missing evidence: ${missing.length} | Overdue: ${overdue.length} | Readiness: ${readiness.overall ?? "n/a"}`
        );
        for (const o of overdue.slice(0, 5)) {
          lines.push(`  OVERDUE: ${o.name}${o.due_date ? ` (due ${o.due_date})` : ""}`);
        }
        htmlParts.push(
          `<h3>${esc(business.name)}</h3>`,
          `<p>Requirements: ${obligations.length} &middot; Missing evidence: ${missing.length} ` +
            `&middot; Overdue: ${overdue.length} &middot; Readiness: ${readiness.overall ?? "n/a"}</p>`,
          overdue.length
            ? `<ul>${overdue.slice(0, 5).map((o) => `<li><strong>Overdue:</strong> ${esc(o.name)}${o.due_date ? ` (due ${esc(o.due_date)})` : ""}</li>`).join("")}</ul>`
            : ""
        );
      }

      const scope = businessId ? "business" : "account";
      const subject = `Your SmartPR ${scope} summary`;
      const text =
        `SmartPR ${scope} summary for ${recipient}\n` +
        `Plan: ${ctx.plan.planId} (${ctx.plan.status})\n\n` +
        (lines.length ? lines.join("\n") : "No businesses found on this account.") +
        `\n\nSent from your SmartPR voice call.`;
      const html =
        `<p>SmartPR ${esc(scope)} summary for ${esc(recipient)}<br/>Plan: ${esc(ctx.plan.planId)} (${esc(ctx.plan.status)})</p>` +
        (htmlParts.length ? htmlParts.join("") : "<p>No businesses found on this account.</p>") +
        `<p style="color:#666;font-size:12px">Sent from your SmartPR voice call.</p>`;

      const delivered = await sendComplianceEmail(recipient, subject, text, html);
      if (!delivered) {
        throw new VoiceAuthError("delivery_failed", "The summary email could not be delivered.", 502);
      }
      await incrementVoiceUsage(db, ctx.userId, "emails_sent", 1);
      await logVoiceAudit(db, {
        userId: ctx.userId,
        action: "email_sent",
        details: { scope, business_count: businesses.length, to_domain: recipient.split("@")[1] },
      });
      return { sent: true, business_count: businesses.length };
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
          `SELECT o.id, d.name
             FROM obligations o
             JOIN documents d ON d.id = o.document_id
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
