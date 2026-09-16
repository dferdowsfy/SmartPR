/**
 * Pre-flight API — the chat step between an action card's Start and the run.
 *
 * GET /api/agency-actions/preflight?business_id=...&action_id=...[&objective_en=...]
 *   → 200 { preflight: Preflight, brief: GoalBrief, filing_label_en/es,
 *           agency_id, portal_account }
 *
 * Returns the pre-flight model: passport items SmartPR will reuse (labels
 * only) plus at most 3 questions (portal account status, sensitive fields,
 * evidence). The client renders it in chat; the actual run starts through
 * POST /api/agency-actions with the answers.
 */
import { isFilingType } from "../../../../lib/agency-runs/store";
import { isAgencyId } from "../../../../lib/agency-runs/agencyActions";
import { getFilingConfig } from "../../../../lib/agency-runs/filingTypes";
import { buildGoalBrief } from "../../../../lib/agency-runs/goalBrief";
import { buildPreflight } from "../../../../lib/agency-runs/preflight";
import { getPortalAccountStatus } from "../../../../lib/agency-runs/portalAccounts";
import { loadProjectContextForBusiness, loadProjectIntentForBusiness } from "../../../../lib/agency-runs/projectContextLoader";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { actionsFor } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const businessId = String(url.searchParams.get("business_id") || "").trim();
  const actionId = String(url.searchParams.get("action_id") || "").trim();

  if (!businessId) {
    return Response.json({ error: "business_id is required." }, { status: 400 });
  }
  if (!actionId || !isFilingType(actionId)) {
    return Response.json({ error: "action_id must be a known filing type." }, { status: 400 });
  }

  const user = await getCurrentUser();
  const config = getFilingConfig(actionId);
  const agencyId = config.agencyId;
  if (!agencyId || !isAgencyId(agencyId)) {
    return Response.json({ error: "action_id is not assigned to an agency." }, { status: 400 });
  }

  const actions = await actionsFor(businessId, agencyId, user?.id ?? null);
  const candidates = actions.filter((a) => a.id === actionId);
  const action = candidates[0];
  if (!action) {
    return Response.json({ error: "action not found for this business." }, { status: 404 });
  }

  // Same objective-variant pick as POST: honor only server-resolved objectives.
  const requestedObjective = String(url.searchParams.get("objective_en") || "").trim();
  const picked =
    candidates.find((a) => a.objective_en === requestedObjective) ?? action;

  if (action.status === "blocked") {
    return Response.json(
      { error: `This action is blocked until ${action.blocked_by.join(", ")} is completed.` },
      { status: 409 }
    );
  }
  if (action.status === "not_required") {
    return Response.json({ error: "This action is not available for this business." }, { status: 409 });
  }

  const portalAccount = await getPortalAccountStatus(businessId, agencyId);
  const brief = buildGoalBrief({
    config,
    action: picked,
    objective_en: picked.objective_en,
    objective_es: picked.objective_es,
    portal_account: portalAccount,
    // Same project-context source as the run-creation route: background
    // only, never a requirement decision.
    project_context:
      (await loadProjectContextForBusiness(businessId, user?.id ?? null)) ?? undefined,
    // Intake branch for this filing (labels only in the prompt block).
    project_intent:
      (await loadProjectIntentForBusiness(businessId, user?.id ?? null)) ?? undefined,
  });
  const preflight = buildPreflight({ config, action: picked, brief, portalAccount });

  return Response.json({
    preflight,
    brief,
    filing_label_en: picked.title_en,
    filing_label_es: picked.title_es,
    agency_id: agencyId,
    portal_account: portalAccount,
  });
}
