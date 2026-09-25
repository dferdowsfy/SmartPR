/**
 * Filing options API — the filing-first agency assistant flow.
 *
 * GET /api/agency-actions/filings?business_id=...[&demo=1]
 *   → { groups: FilingGroup[] } — every SmartPR obligation for the business
 *     joined to its browser filing (when one exists), grouped by agency.
 *
 * Agency is visual grouping only: the execution objective is always the
 * specific obligation/filing, never the agency. Obligations with no mapped
 * browser filing surface as disabled "not yet supported" entries — the
 * picker never falls back to agency-first browsing.
 *
 * Labels only in the response — never field values, never secrets.
 */
import { listRunsForBusiness } from "../../../../lib/agency-runs/store";
import {
  resolveFilingOptions,
  type FilingGroup,
} from "../../../../lib/agency-runs/agencyActions";
import { loadPassportForBusiness } from "../../../../lib/agency-runs/passportLoader";
import { getBusinessObligations } from "../../voice/_business";
import { getPool, isEnabled } from "../../../graph/db";
import { resolveBusinessUuid } from "../../../graph/store";
import { getCurrentUser } from "../../../../lib/supabase/server";
import {
  buildFilingReadiness,
  type FilingReadinessSummary,
} from "../../../../lib/agency-runs/filingReadiness";
import {
  canonicalFromBusinessRow,
  passportCoverage,
  type BusinessPassportJson,
} from "../../../forms/engine/businessPassport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve filing options for a business (labels only). Shared with the
 * preflight and run-creation routes so the obligation join is validated
 * server-side in all three places. includeDemo is always true here — the
 * demo portal is fictional and harmless; the filings *list* endpoint is the
 * only place demo visibility is gated (admin / ?demo=1).
 */
export async function filingsFor(
  businessId: string,
  userId: string | null,
  includeDemo = true
): Promise<FilingGroup[]> {
  const pool = getPool();
  if (!pool) return [];
  // Business ids in URLs are short public ids (e.g. /businesses/udjpeyxd),
  // but obligations.business_id is UUID-typed — resolve before querying or
  // Postgres throws 22P02 and the endpoint 500s.
  const businessUuid = await resolveBusinessUuid(pool, businessId);
  if (!businessUuid) return [];
  const [obligations, passport, priorRuns] = await Promise.all([
    getBusinessObligations(pool, businessUuid),
    loadPassportForBusiness(businessId, userId),
    Promise.resolve(listRunsForBusiness(businessId)),
  ]);
  return resolveFilingOptions({
    business_id: businessId,
    passport,
    priorRuns,
    obligations,
    includeDemo,
  });
}

/**
 * Documents on file + per-filing readiness counts for the chat. Only for a
 * signed-in user who can access the business (evidence is owner data).
 */
async function readinessFor(
  businessId: string,
  userId: string | null,
  groups: FilingGroup[]
): Promise<FilingReadinessSummary | null> {
  const pool = getPool();
  if (!pool || !userId) return null;
  try {
    const businessUuid = await resolveBusinessUuid(pool, businessId);
    if (!businessUuid) return null;
    const passport = await loadPassportForBusiness(businessId, userId);
    if (!passport) return null; // null = no access (or no DB) — show nothing
    const [evidence, obligations] = await Promise.all([
      pool.query(
        `SELECT document_type, original_filename, review_status, requirement_tags
           FROM evidence WHERE business_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [businessUuid]
      ),
      pool.query(`SELECT name, requirement_id FROM obligations WHERE business_id=$1`, [businessUuid]),
    ]);
    const coverage = passportCoverage(
      canonicalFromBusinessRow({ passport_json: passport as unknown as BusinessPassportJson })
    );
    return buildFilingReadiness({
      groups,
      evidence: evidence.rows,
      obligations: obligations.rows,
      passport: { filled: coverage.filled.length, total: coverage.filled.length + coverage.empty.length },
    });
  } catch (err) {
    console.error("[agency-actions/filings] readiness failed:", (err as Error).message);
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const businessId = String(url.searchParams.get("business_id") || "").trim();

  if (!businessId) {
    return Response.json({ error: "business_id is required." }, { status: 400 });
  }
  if (!isEnabled()) {
    return Response.json(
      { error: "SmartPR requirements are unavailable right now." },
      { status: 503 }
    );
  }

  const user = await getCurrentUser();
  const includeDemo = url.searchParams.get("demo") === "1";
  const groups = await filingsFor(businessId, user?.id ?? null, includeDemo);
  const readiness = await readinessFor(businessId, user?.id ?? null, groups);
  return Response.json({ groups, readiness });
}
