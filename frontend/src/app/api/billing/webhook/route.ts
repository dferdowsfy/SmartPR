import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { resolvePlanId } from "@/lib/billing/entitlements";
import { getStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";

/**
 * Persist subscription state.
 *
 * Schema: see data/billing_schema.sql (workspace_subscriptions).
 * Tries `getPool` from `frontend/src/app/graph/db` when available;
 * otherwise logs and no-ops with a TODO.
 */
async function upsertSubscription(row: {
  workspaceId: string | null;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  // TODO: map client_reference_id / customer metadata → workspace_id
  // and upsert into workspace_subscriptions once workspaces are linked.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (await import("../../../graph/db")) as any;
    const getPool: (() => { query: Function }) | undefined = db.getPool;
    if (!getPool || !row.workspaceId) {
      console.info("[billing/webhook] skip DB write", {
        reason: !getPool ? "getPool unavailable" : "no workspaceId",
        plan: row.plan,
        status: row.status,
        stripeSubscriptionId: row.stripeSubscriptionId,
      });
      return;
    }
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO workspace_subscriptions (
        workspace_id, plan, status,
        stripe_customer_id, stripe_subscription_id, stripe_price_id,
        current_period_end, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (workspace_id) DO UPDATE SET
        plan = EXCLUDED.plan,
        status = EXCLUDED.status,
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, workspace_subscriptions.stripe_customer_id),
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, workspace_subscriptions.stripe_subscription_id),
        stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, workspace_subscriptions.stripe_price_id),
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW()
      `,
      [
        row.workspaceId,
        row.plan,
        row.status,
        row.stripeCustomerId,
        row.stripeSubscriptionId,
        row.stripePriceId,
        row.currentPeriodEnd,
      ]
    );
  } catch (err) {
    // Import missing or DB not ready — log and continue (MVP-safe).
    console.info("[billing/webhook] DB upsert skipped", {
      error: err instanceof Error ? err.message : String(err),
      plan: row.plan,
      status: row.status,
    });
  }
}

function priceFromSubscription(
  sub: Stripe.Subscription
): string | null {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  // current_period_end is unix seconds on Subscription
  const end = (sub as Stripe.Subscription & { current_period_end?: number })
    .current_period_end;
  if (typeof end !== "number") return null;
  return new Date(end * 1000);
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const planFromMeta = session.metadata?.planId ?? null;
  let priceId: string | null = null;

  if (session.mode === "subscription" && session.subscription) {
    const stripe = getStripe();
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    priceId = priceFromSubscription(sub);
    const plan =
      resolvePlanId({ planId: planFromMeta, priceId }) ?? "core";
    await upsertSubscription({
      workspaceId: session.client_reference_id,
      plan,
      status: sub.status,
      stripeCustomerId:
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id ?? null,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      currentPeriodEnd: periodEnd(sub),
    });
    return;
  }

  // one_time (pilot)
  if (session.mode === "payment") {
    const plan =
      resolvePlanId({ planId: planFromMeta, priceId: null }) ?? "pilot";
    await upsertSubscription({
      workspaceId: session.client_reference_id,
      plan,
      status: "active",
      stripeCustomerId:
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id ?? null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      currentPeriodEnd: null,
    });
  }
}

async function handleSubscriptionChange(
  sub: Stripe.Subscription,
  deleted = false
): Promise<void> {
  const priceId = priceFromSubscription(sub);
  const plan =
    resolvePlanId({
      planId: sub.metadata?.planId ?? null,
      priceId,
    }) ?? "free";

  await upsertSubscription({
    workspaceId: sub.metadata?.workspace_id ?? null,
    plan: deleted ? "free" : plan,
    status: deleted ? "canceled" : sub.status,
    stripeCustomerId:
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    currentPeriodEnd: deleted ? null : periodEnd(sub),
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not set." },
      { status: 500 }
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

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 }
    );
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Webhook signature verification failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session
        );
        break;
      case "customer.subscription.updated":
        await handleSubscriptionChange(
          event.data.object as Stripe.Subscription,
          false
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionChange(
          event.data.object as Stripe.Subscription,
          true
        );
        break;
      default:
        // Ignore other event types for MVP.
        break;
    }
  } catch (err) {
    console.error("[billing/webhook] handler error", err);
    return NextResponse.json(
      { error: "Webhook handler failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
