// email_my_summary — authenticated voice API.
// POST /api/voice/v1/email-summary { business_id? }
//
// Emails an account summary to the caller's VERIFIED SmartPR email on file.
// The request MUST NOT include an email address argument — the recipient is
// always derived server-side from the validated voice session, never chosen
// by the agent. Available on all plans (including free); recurring
// compliance reminders remain governed by the existing paid-plan rules.

import { getPool, isEnabled } from "../../../../graph/db";
import { sendComplianceEmail } from "../../../../../lib/compliance-reminders";
import {
  auditedToolCall,
  listAccessibleBusinesses,
  requireBusinessAccess,
  resolveVoiceContext,
  voiceError,
} from "../../_voice";
import { getBusinessObligations, getBusinessReadiness } from "../../_business";
import { incrementVoiceUsage } from "../../../../../lib/voice/usage";
import { logVoiceAudit } from "../../../../../lib/voice/audit";
import { readJson } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function POST(request: Request) {
  try {
    if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
    const pool = getPool();
    if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
    const ctx = await resolveVoiceContext(request.headers.get("authorization"), pool);

    const recipient = ctx.email;
    if (!recipient || !recipient.includes("@")) {
      return Response.json(
        { error: "no_verified_email", message: "No verified email is on file for this account." },
        { status: 422 }
      );
    }

    const body = await readJson(request);
    // NOTE: any "email"/"to"/"recipient" field in the body is deliberately
    // ignored. The recipient always comes from the voice session.
    const businessId =
      typeof body.business_id === "string" && body.business_id ? body.business_id : null;

    const sent = await auditedToolCall(
      pool,
      ctx,
      "email_my_summary",
      { business_id: businessId },
      async () => {
        const businesses = businessId
          ? [await requireBusinessAccess(pool, ctx, businessId)]
          : await listAccessibleBusinesses(pool, ctx);

        const lines: string[] = [];
        const htmlParts: string[] = [];
        for (const business of businesses) {
          const [obligations, readiness] = await Promise.all([
            getBusinessObligations(pool, business.id),
            getBusinessReadiness(pool, business.id),
          ]);
          const overdue = obligations.filter((o) => o.status === "OVERDUE");
          const missing = obligations.filter((o) =>
            ["NONE", "FAILED", "NEEDS_REVIEW"].includes(o.evidence_state)
          );
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
          throw new Error("Email delivery failed.");
        }
        await incrementVoiceUsage(pool, ctx.userId, "emails_sent", 1);
        await logVoiceAudit(pool, {
          userId: ctx.userId,
          action: "email_sent",
          details: { scope, business_count: businesses.length, to_domain: recipient.split("@")[1] },
        });
        return { sent: true, business_count: businesses.length };
      }
    );
    return Response.json(sent);
  } catch (err) {
    if ((err as Error).message === "Email delivery failed.") {
      return Response.json({ error: "delivery_failed" }, { status: 502 });
    }
    return voiceError(err);
  }
}
