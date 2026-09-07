import { NextRequest, NextResponse } from "next/server";
import {
  getPriceId,
  isPlanId,
  type BillingPeriod,
  type PlanId,
} from "@/lib/billing/catalog";
import { appUrl, getStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";

type CheckoutBody = {
  planId?: string;
  period?: string;
};

function parsePeriod(raw: string | undefined): BillingPeriod | null {
  if (raw === "monthly" || raw === "yearly" || raw === "one_time") return raw;
  return null;
}

/**
 * Optional: attach Supabase user as client_reference_id when available.
 * Skips silently if @/lib/supabase/server is not present.
 */
async function tryClientReferenceId(): Promise<string | undefined> {
  try {
    // Dynamic import keeps this route usable without Supabase wired yet.
    const mod = await import("@/lib/supabase/server");
    const createClient =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mod as any).createClient ?? (mod as any).createServerClient;
    if (typeof createClient !== "function") return undefined;
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? undefined;
  } catch {
    return undefined;
  }
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

  // Pilot is one_time only; subscriptions use monthly/yearly.
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
  const clientReferenceId = await tryClientReferenceId();

  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/pricing?success=1`,
      cancel_url: `${base}/pricing?cancel=1`,
      allow_promotion_codes: true,
      client_reference_id: clientReferenceId,
      metadata: {
        planId,
        period,
      },
      ...(mode === "subscription"
        ? {
            subscription_data: {
              metadata: { planId, period },
            },
          }
        : {}),
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
