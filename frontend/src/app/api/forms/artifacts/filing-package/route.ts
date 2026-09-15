// Filing package for a business profile.
// POST { description?, profile? } -> { extraction, questions, package }
//
// Read-only: this route resolves which government artifacts apply and how much
// of each SmartPR can already answer. It generates no documents and submits
// nothing.
import { resolveApplicableArtifacts, type ApplicabilityOptions } from "../../../../forms/artifacts/applicability";
import { buildFilingPackage } from "../../../../forms/artifacts/filingPackage";
import { applyExtraction, extractIntake } from "../../../../forms/artifacts/intakeExtraction";
import { loadMunicipalities } from "../../../../forms/artifacts/kbLoader";
import { loadAllMappings, outstandingQuestionsForProfile } from "../../../../forms/artifacts/library";
import { type CanonicalApplicationData } from "../../../../forms/engine/types";
import { resolvePopulationProfile, type BusinessRowFacts } from "../../../../forms/engine/businessPassport";
import { getPool } from "../../../../graph/db";
import { resolveBusinessUuid } from "../../../../graph/store";
import { getCurrentUser } from "../../../../../lib/supabase/server";
import { userCanAccessBusiness } from "../../../../compliance/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  description?: string;
  profile?: Partial<CanonicalApplicationData>;
  businessId?: string;
  options?: ApplicabilityOptions;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  let businessRow: BusinessRowFacts | null = null;
  if (body.businessId) {
    const user = await getCurrentUser();
    const pool = getPool();
    if (user && pool) {
      const businessUuid = await resolveBusinessUuid(pool, body.businessId);
      if (businessUuid && await userCanAccessBusiness(pool, user.id, businessUuid)) {
        const { rows } = await pool.query(
          `SELECT legal_name, name, entity_number, business_structure, municipality,
                  physical_address, onboarding_mode, passport_json
             FROM businesses WHERE id=$1 AND archived=false`,
          [businessUuid]
        );
        businessRow = rows[0] ?? null;
      }
    }
  }
  const base = resolvePopulationProfile({
    business: businessRow,
    requestProfile: body.profile ?? null,
  });
  const extraction = body.description
    ? extractIntake(body.description.slice(0, 2000), loadMunicipalities())
    : null;
  const profile = extraction ? applyExtraction(extraction, base) : base;

  const artifacts = resolveApplicableArtifacts(profile, body.options ?? {});
  const questions = outstandingQuestionsForProfile(profile, artifacts);
  const filingPackage = buildFilingPackage({ profile, artifacts, mappings: loadAllMappings() });

  return Response.json({
    extraction: extraction
      ? {
          business_type: extraction.businessType,
          municipality: extraction.municipality,
          employee_count: extraction.employeeCount,
          activities: extraction.activities,
          evidence: extraction.evidence,
        }
      : null,
    questions,
    package: filingPackage,
  });
}
