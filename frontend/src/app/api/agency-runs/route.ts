/**
 * POST /api/agency-runs — start a mock agency assistant run.
 * In-memory store only (see lib/agency-runs/store.ts). No real browser automation.
 */
import { createRun, isFilingType } from "../../../lib/agency-runs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { business_id?: string; filing_type?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const businessId = String(body.business_id || "").trim();
  const filingType = String(body.filing_type || "").trim();

  if (!businessId) {
    return Response.json({ error: "business_id is required." }, { status: 400 });
  }
  if (!isFilingType(filingType)) {
    return Response.json(
      {
        error: "filing_type must be SURI_REGISTER_TAXPAYER or SURI_MERCHANT_REGISTRATION.",
      },
      { status: 400 }
    );
  }

  const run = createRun({ business_id: businessId, filing_type: filingType });
  return Response.json({ run }, { status: 201 });
}
