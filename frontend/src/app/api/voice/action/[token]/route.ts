/**
 * SmartPR Voice Phase 3: secure action/upload link redemption.
 *
 * GET /api/voice/action/{token}
 *
 * The link is single-purpose, expiring, and scoped. Redemption re-authorizes:
 * the visitor must be signed in as the SAME user the link was issued to, and
 * must still have access to the business. Anonymous visitors are sent to
 * sign-in; a mismatched user gets a safe denial (and the denial is audited).
 */

import { NextResponse } from "next/server";
import { getPool, isEnabled } from "../../../../graph/db";
import { getCurrentUser } from "../../../../../lib/supabase/server";
import { userCanAccessBusiness } from "../../../../compliance/server";
import {
  lookupSecureLink,
  recordLinkUse,
} from "../../../../../lib/voice/secureLinks";
import { logVoiceAudit } from "../../../../../lib/voice/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function denied(message: string) {
  return new NextResponse(
    `<html><body style="font-family:system-ui;padding:40px;max-width:560px;margin:auto">` +
      `<h1>SmartPR secure link</h1><p>${message}</p>` +
      `<p><a href="/signin">Sign in to SmartPR</a></p></body></html>`,
    { status: 403, headers: { "Content-Type": "text/html" } }
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!isEnabled()) return denied("SmartPR is temporarily unavailable. Please try again later.");
  const pool = getPool();
  if (!pool) return denied("SmartPR is temporarily unavailable. Please try again later.");

  const link = await lookupSecureLink(pool, token);
  if (!link) {
    return denied("This link is invalid, expired, or has already been used.");
  }

  const user = await getCurrentUser();
  if (!user) {
    // Send to sign-in; the link itself stays valid for the retry.
    return NextResponse.redirect(new URL("/signin", process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.getsmartpr.com"));
  }
  if (user.id !== link.userId) {
    await logVoiceAudit(pool, {
      userId: user.id,
      action: "secure_link_denied",
      details: { reason: "user_mismatch", purpose: link.purpose },
    });
    return denied("This link belongs to a different SmartPR account. Please sign in with the account that received the link.");
  }
  if (link.businessId) {
    const ok = await userCanAccessBusiness(pool, user.id, link.businessId);
    if (!ok) {
      await logVoiceAudit(pool, {
        userId: user.id,
        action: "secure_link_denied",
        details: { reason: "business_access", purpose: link.purpose },
      });
      return denied("You no longer have access to the business this link was created for.");
    }
  }

  // Authorization passed — consume one use and route to the real web flow.
  await recordLinkUse(pool, token);
  await logVoiceAudit(pool, {
    userId: user.id,
    action: "secure_link_redeemed",
    details: { purpose: link.purpose, action_type: link.actionType, business_id: link.businessId },
  });

  if (link.purpose === "upload_evidence" && link.businessId) {
    return NextResponse.redirect(new URL(`/businesses/${link.businessId}`, process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.getsmartpr.com"));
  }
  if (link.purpose === "secure_action" && link.actionType === "download_deliverable") {
    const deliverableId = (link.payload as { deliverable_id?: string }).deliverable_id;
    if (deliverableId) {
      return NextResponse.redirect(
        new URL(`/api/deliverables/${deliverableId}/download`, process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.getsmartpr.com")
      );
    }
  }
  // Sensitive-action links land the signed-in user at the business workspace
  // where the action's real web flow lives.
  const fallback = link.businessId ? `/businesses/${link.businessId}` : "/dashboard";
  return NextResponse.redirect(new URL(fallback, process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.getsmartpr.com"));
}
