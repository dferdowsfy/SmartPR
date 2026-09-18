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
import { getCurrentUser } from "../../../../lib/supabase/server";

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
  const [obligations, passport, priorRuns] = await Promise.all([
    getBusinessObligations(pool, businessId),
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
  return Response.json({ groups });
}
