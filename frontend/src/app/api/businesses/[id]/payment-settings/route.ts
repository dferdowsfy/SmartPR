// Business Passport payment settings: the opt-in filing-fee card reminder.
// Returns display details only (brand, last 4, expiry) — never the Stripe
// reference, and there is no card number to return. DELETE withdraws consent.

import { getPool, isEnabled } from "../../../../graph/db";
import { ensureSchema } from "../../../../graph/store";
import { getCurrentUser } from "../../../../../lib/supabase/server";
import { toPublicFilingFeeCard } from "../../../../../lib/billing/filingFeeCard";
import {
  accessibleBusinessUuid,
  clearFilingFeeCard,
  loadFilingFeeCard,
} from "../../../../../lib/billing/filingFeeCardStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolve(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (!isEnabled()) return { error: Response.json({ error: "no_database" }, { status: 503 }) };
  const pool = getPool();
  if (!pool) return { error: Response.json({ error: "no_database" }, { status: 503 }) };
  await ensureSchema();
  const businessUuid = await accessibleBusinessUuid(pool, id, user.id);
  if (!businessUuid) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  return { pool, businessUuid };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  const card = await loadFilingFeeCard(r.pool, r.businessUuid);
  return Response.json(
    { filingFeeCard: toPublicFilingFeeCard(card) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  await clearFilingFeeCard(r.pool, r.businessUuid);
  return Response.json({ filingFeeCard: null });
}
