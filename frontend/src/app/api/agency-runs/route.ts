/**
 * POST /api/agency-runs — RETIRED (HTTP 410 Gone).
 *
 * Agency runs no longer start from a raw filing_type. Every run must begin
 * from a specific SmartPR filing requirement: pick an obligation from
 * GET /api/agency-actions/filings?business_id=… , pre-flight it with
 * GET /api/agency-actions/preflight, and launch through
 * POST /api/agency-actions with obligation_id.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request) {
  return Response.json(
    {
      error:
        "This endpoint is retired. Start agency runs from a SmartPR filing requirement: GET /api/agency-actions/filings?business_id=… then POST /api/agency-actions with obligation_id.",
    },
    { status: 410 }
  );
}
