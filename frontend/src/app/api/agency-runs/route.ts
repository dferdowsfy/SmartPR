/**
 * POST /api/agency-runs — start an agency assistant run.
 * Uses Browser Use Cloud when BROWSER_USE_API_KEY is set; otherwise in-memory mock.
 * API key never leaves the server.
 */
import { createRun, isFilingType } from "../../../lib/agency-runs/store";
import { loadPassportForBusiness } from "../../../lib/agency-runs/passportLoader";
import { getCurrentUser } from "../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    business_id?: string;
    filing_type?: string;
    passport?: Record<string, unknown>;
  };
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

  const user = await getCurrentUser();
  const { isBrowserUseConfigured } = await import("../../../lib/agency-runs/browserUseClient");
  // Live Cloud sessions require an authenticated owner so live_url stays private.
  if (isBrowserUseConfigured() && !user) {
    return Response.json(
      { error: "Sign in required to start a live Browser Use agency run." },
      { status: 401 }
    );
  }

  const passportFromBody =
    body.passport && typeof body.passport === "object" ? body.passport : null;
  const passport =
    passportFromBody || (await loadPassportForBusiness(businessId, user?.id ?? null));

  const run = await createRun({
    business_id: businessId,
    filing_type: filingType,
    owner_user_id: user?.id ?? null,
    passport,
  });
  return Response.json({ run }, { status: 201 });
}
