import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { resolvePlanId } from "@/lib/billing/entitlements";
import { getStripe } from "@/lib/billing/stripe";
import { getPool } from "../../../graph/db";

export const runtime = "nodejs";

async function upsertSubscription(row: {
  workspaceId: string | null;
  plan: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const pool = getPool();
  if (!pool || !row.workspaceId) {
    console.info("[billing/webhook] skip DB write", {
      reason: !pool ? "getPool unavailable" : "no workspaceId",
      plan: row.plan,
      status: row.status,
      stripeSubscriptionId: row.stripeSubscriptionId,
    });
    return;
  }

  const kind =
    row.plan === "partner" || row.plan === "enterprise"
      ? "PROFESSIONAL"
      : "INDIVIDUAL";

  await pool.query(`UPDATE workspaces SET kind = $2 WHERE id = $1`, [
    row.workspaceId,
    kind,
  ]);

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
}

async function workspaceFromStripeIds(input: {
  workspaceId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
}): Promise<string | null> {
  if (input.workspaceId) return input.workspaceId;
  const pool = getPool();
  if (!pool) return null;
  if (input.subscriptionId) {
    const { rows } = await pool.query(
      `SELECT workspace_id FROM workspace_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
      [input.subscriptionId]
    );
    if (rows[0]?.workspace_id) return rows[0].workspace_id as string;
  }
  if (input.customerId) {
    const { rows } = await pool.query(
      `SELECT workspace_id FROM workspace_subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
      [input.customerId]
    );
    if (rows[0]?.workspace_id) return rows[0].workspace_id as string;
  }
  return null;
}

function priceFromSubscription(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  const end = (sub as Stripe.Subscription & { current_period_end?: number })
    .current_period_end;
  if (typeof end !== "number") return null;
  return new Date(end * 1000);
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const planFromMeta = session.metadata?.planId ?? null;
  const workspaceFromMeta =
    session.metadata?.workspace_id ?? session.client_reference_id ?? null;

  if (session.mode === "subscription" && session.subscription) {
    const stripe = getStripe();
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    const priceId = priceFromSubscription(sub);
    const plan =
      resolvePlanId({ planId: planFromMeta, priceId }) ?? "core";
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;
    const workspaceId = await workspaceFromStripeIds({
      workspaceId: workspaceFromMeta,
      subscriptionId: sub.id,
      customerId,
    });
    await upsertSubscription({
      workspaceId,
      plan,
      status: sub.status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      currentPeriodEnd: periodEnd(sub),
    });
    return;
  }

  if (session.mode === "payment") {
    const plan =
      resolvePlanId({ planId: planFromMeta, priceId: null }) ?? "pilot";
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;
    const workspaceId = await workspaceFromStripeIds({
      workspaceId: workspaceFromMeta,
      customerId,
    });
    await upsertSubscription({
      workspaceId,
      plan,
      status: "active",
      stripeCustomerId: customerId,
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
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  const workspaceId = await workspaceFromStripeIds({
    workspaceId: sub.metadata?.workspace_id ?? null,
    subscriptionId: sub.id,
    customerId,
  });

  await upsertSubscription({
    workspaceId,
    plan: deleted ? "free" : plan,
    status: deleted ? "canceled" : sub.status,
    stripeCustomerId: customerId,
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
      case "customer.subscription.created":
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
      case "invoice.paid":
      case "invoice.payment_failed": {
        // Recurring renewals / failures: subscription object may be on invoice.
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = (invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }).subscription;
        if (!subRef) break;
        const subId = typeof subRef === "string" ? subRef : subRef.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        await handleSubscriptionChange(
          sub,
          event.type === "invoice.payment_failed" && sub.status === "canceled"
        );
        break;
      }
      default:
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
