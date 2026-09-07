import { NextRequest, NextResponse } from "next/server";
import {
  getPriceId,
  isPlanId,
  type BillingPeriod,
  type PlanId,
} from "@/lib/billing/catalog";
import { appUrl, getStripe } from "@/lib/billing/stripe";
import { getCurrentUser } from "@/lib/supabase/server";
import { getPool } from "../../../graph/db";

export const runtime = "nodejs";

type CheckoutBody = {
  planId?: string;
  period?: string;
};

function parsePeriod(raw: string | undefined): BillingPeriod | null {
  if (raw === "monthly" || raw === "yearly" || raw === "one_time") return raw;
  return null;
}

async function resolveWorkspaceId(userId: string): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    `
    SELECT w.id
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = $1
    ORDER BY CASE WHEN wm.role = 'OWNER' THEN 0 ELSE 1 END, w.created_at ASC
    LIMIT 1
    `,
    [userId]
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

export async function POST(req: NextRequest) {
  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const planId = body.planId;
  if (!planId || !isPlanId(planId)) {
    return NextResponse.json({ error: "Invalid planId." }, { status: 400 });
  }

  if (planId === "enterprise") {
    return NextResponse.json(
      { error: "Enterprise is contact-only. Email hello@getsmartpr.com." },
      { status: 400 }
    );
  }

  if (planId === "free") {
    return NextResponse.json(
      { error: "Free plan does not use Checkout. Use /?entry=new-business." },
      { status: 400 }
    );
  }

  const period = parsePeriod(body.period);
  if (!period) {
    return NextResponse.json(
      { error: "period must be monthly, yearly, or one_time." },
      { status: 400 }
    );
  }

  if (planId === "pilot" && period !== "one_time") {
    return NextResponse.json(
      { error: "Pilot requires period one_time." },
      { status: 400 }
    );
  }
  if (planId !== "pilot" && period === "one_time") {
    return NextResponse.json(
      { error: "one_time is only valid for pilot." },
      { status: 400 }
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in required before checkout so your plan can be saved." },
      { status: 401 }
    );
  }

  const workspaceId = await resolveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: "No workspace found for your account. Finish signup first." },
      { status: 400 }
    );
  }

  const priceId = getPriceId(planId as PlanId, period);
  if (!priceId) {
    return NextResponse.json(
      { error: "No Stripe price configured for this plan/period." },
      { status: 400 }
    );
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Stripe is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const base = appUrl();
  const mode = period === "one_time" ? "payment" : "subscription";
  const meta = {
    planId,
    period,
    workspace_id: workspaceId,
    user_id: user.id,
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/pricing?success=1`,
      cancel_url: `${base}/pricing?cancel=1`,
      allow_promotion_codes: true,
      client_reference_id: workspaceId,
      customer_email: user.email || undefined,
      metadata: meta,
      ...(mode === "subscription"
        ? {
            subscription_data: {
              metadata: meta,
            },
          }
        : {
            payment_intent_data: {
              metadata: meta,
            },
          }),
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a Checkout URL." },
        { status: 502 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Checkout session failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
