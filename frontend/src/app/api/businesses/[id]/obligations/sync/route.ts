// Sync intake-computed requirements into persisted obligations.
//
// Clara's filing picker (and the ?filing= deep link) reads obligations from
// the database. The intake computes requirements client-side and never wrote
// them — so entering Clara straight from intake always landed on the empty
// "nothing I can file" state. The requirement cards call this endpoint
// before navigating to the Clara workspace; the upsert is idempotent
// (matter_id, requirement_id, cycle_index), so repeat visits are harmless.
//
// POST /api/businesses/[id]/obligations/sync
// Body: { requirements: [{ document_id?, name, agency?, mandatory?, source_rule? }] }

import { getPool, isEnabled } from "../../../../../graph/db";
import {
  ensureSchema,
  projectRequirementsToObligations,
  resolveBusinessUuid,
  type ProjectedRequirement,
} from "../../../../../graph/store";
import { getCurrentUser } from "../../../../../../lib/supabase/server";
import { createMatterRecord } from "../../../../../../lib/matters";
import { ensureUserWorkspace, userCanAccessBusiness } from "../../../../../compliance/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  // Intake-local ids (local-*) are never persisted businesses — there is
  // nothing to sync; Clara handles them with its empty state.
  if (id.startsWith("local-")) {
    return Response.json({ error: "not_persisted" }, { status: 400 });
  }
  const body: { requirements?: unknown } = await req.json().catch(() => ({}));
  const raw: unknown[] = Array.isArray(body.requirements) ? body.requirements : [];
  await ensureSchema();
  const client = await pool.connect();
  try {
    const businessUuid = await resolveBusinessUuid(client, id);
    if (!businessUuid || !(await userCanAccessBusiness(client, user.id, businessUuid))) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    // Anchor to the business's latest matter; create one when none exists.
    // The obligation upsert dedupes on (matter_id, requirement_id,
    // cycle_index), so syncing against a fresh matter is still idempotent
    // per requirement.
    const matterRow = await client.query<{ id: string }>(
      `SELECT id FROM matters WHERE business_id = $1 ORDER BY opened_at DESC LIMIT 1`,
      [businessUuid]
    );
    let matterId = matterRow.rows[0]?.id ?? null;
    if (!matterId) {
      const workspaceId = await ensureUserWorkspace(client, user);
      ({ matterId } = await createMatterRecord(client, {
        businessId: businessUuid,
        workspaceId,
        userId: user.id,
        matterType: "NEW_BUSINESS_FORMATION",
        title: "New business formation",
      }));
    }
    const projected: ProjectedRequirement[] = raw
      .filter(
        (r: unknown): r is Record<string, unknown> =>
          !!r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string" &&
          (r as { name: string }).name.trim().length > 0
      )
      .map((r: Record<string, unknown>) => ({
        document_id: typeof r.document_id === "string" && r.document_id ? r.document_id : null,
        name: (r.name as string).trim(),
        agency: typeof r.agency === "string" && r.agency ? r.agency : null,
        mandatory: r.mandatory !== false,
        source_rule: typeof r.source_rule === "string" && r.source_rule ? r.source_rule : null,
      }));
    await projectRequirementsToObligations(client, {
      businessId: businessUuid,
      matterId,
      userId: user.id,
      requirements: projected,
    });
    return Response.json({ ok: true, synced: projected.length });
  } finally {
    client.release();
  }
}
