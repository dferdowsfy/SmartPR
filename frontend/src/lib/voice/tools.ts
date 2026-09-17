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
