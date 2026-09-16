/**
 * Agency actions API — the action-first agency assistant flow.
 *
 * GET /api/agency-actions?business_id=...&agency=HACIENDA_SURI
 *   → { actions: AgencyAction[] } — readiness per filing (labels only, no values).
 *
 * POST /api/agency-actions { business_id, action_id }
 *   → resolves the action, builds the labels-only goal brief, and starts an
 *   agency run through the existing createRun path with the brief attached.
 *   Responds 201 { run: AgencyRunPublic, brief: GoalBrief }.
 */
import {
  createRun,
  isFilingType,
  listRunsForBusiness,
} from "../../../lib/agency-runs/store";
import {
  AGENCY_IDS,
  isAgencyId,
  resolveAgencyActions,
  type AgencyAction,
} from "../../../lib/agency-runs/agencyActions";
import { getFilingConfig } from "../../../lib/agency-runs/filingTypes";
import { buildGoalBrief } from "../../../lib/agency-runs/goalBrief";
import { loadPassportForBusiness } from "../../../lib/agency-runs/passportLoader";
import { loadProjectContextForBusiness } from "../../../lib/agency-runs/projectContextLoader";
import { parseAccountStatusAnswer } from "../../../lib/agency-runs/preflight";
import {
  getPortalAccountStatus,
  setPortalAccountStatus,
} from "../../../lib/agency-runs/portalAccounts";
import { getCurrentUser } from "../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve agency actions for a business+agency (labels only, no values). Shared with the preflight route. */
export async function actionsFor(
  businessId: string,
  agencyId: string,
  userId: string | null
): Promise<AgencyAction[]> {
  const passport = await loadPassportForBusiness(businessId, userId);
  const priorRuns = listRunsForBusiness(businessId);
  return resolveAgencyActions({
    business_id: businessId,
    agency_id: agencyId,
    passport,
    priorRuns,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const businessId = String(url.searchParams.get("business_id") || "").trim();
  const agency = String(url.searchParams.get("agency") || "").trim();

  if (!businessId) {
    return Response.json({ error: "business_id is required." }, { status: 400 });
  }
  if (!agency || !isAgencyId(agency)) {
    return Response.json(
      {
        error: `agency must be one of: ${AGENCY_IDS.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  const user = await getCurrentUser();
  const actions = await actionsFor(businessId, agency, user?.id ?? null);
  return Response.json({ actions });
}

export async function POST(request: Request) {
  let body: {
    business_id?: string;
    action_id?: string;
    objective_en?: string;
    objective_es?: string;
    /**
     * Pre-flight answers from chat (optional). account_status is the human's
     * answer to the portal-account question; fields are up-front sensitive
     * field values keyed by missing-item id — ephemeral, never persisted.
     */
    preflight_answers?: {
      account_status?: unknown;
      fields?: Record<string, unknown> | null;
    } | null;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const businessId = String(body.business_id || "").trim();
  const actionId = String(body.action_id || "").trim();

  if (!businessId) {
    return Response.json({ error: "business_id is required." }, { status: 400 });
  }
  if (!actionId || !isFilingType(actionId)) {
    return Response.json({ error: "action_id must be a known filing type." }, { status: 400 });
  }

  const user = await getCurrentUser();
  const { isBrowserUseConfigured } = await import(
    "../../../lib/agency-runs/browserUseClient"
  );
  // Live Cloud sessions require an authenticated owner so live_url stays private.
  if (isBrowserUseConfigured() && !user) {
    return Response.json(
      { error: "Sign in required to start a live Browser Use agency run." },
      { status: 401 }
    );
  }

  const config = getFilingConfig(actionId);
  const agencyId = config.agencyId;
  if (!agencyId) {
    return Response.json(
      { error: "action_id is not assigned to an agency." },
      { status: 400 }
    );
  }

  const actions = await actionsFor(businessId, agencyId, user?.id ?? null);
  const candidates = actions.filter((a) => a.id === actionId);
  const action = candidates[0];
  if (!action) {
    return Response.json({ error: "action not found for this business." }, { status: 404 });
  }

  // When one filing type resolves to multiple objective variants (e.g. Dept.
  // of State new-entity vs annual report), honor the variant the human picked
  // in chat — but only if it matches a server-resolved objective. Never take
  // free-form objective text from the client into the agent prompt.
  const requestedObjective = String(body.objective_en || "").trim();
  const picked =
    candidates.find((a) => a.objective_en === requestedObjective) ?? action;

  if (action.status === "blocked") {
    return Response.json(
      {
        error: `This action is blocked until ${action.blocked_by.join(", ")} is completed.`,
      },
      { status: 409 }
    );
  }
  if (action.status === "not_required") {
    return Response.json(
      { error: "This action is not available for this business." },
      { status: 409 }
    );
  }

  const brief = buildGoalBrief({
    config,
    action: picked,
    objective_en: picked.objective_en,
    objective_es: picked.objective_es,
    portal_account: await resolvePortalAccount(businessId, agencyId, body.preflight_answers),
    // Project-context facts from the latest intake snapshot (background
    // only — the brief marks them as never driving requirement decisions).
    project_context:
      (await loadProjectContextForBusiness(businessId, user?.id ?? null)) ?? undefined,
  });
  const passport = await loadPassportForBusiness(businessId, user?.id ?? null);
  const run = await createRun({
    business_id: businessId,
    filing_type: action.filing_type,
    owner_user_id: user?.id ?? null,
    passport,
    goalBrief: brief,
    fields: sanitizePreflightFields(picked, body.preflight_answers?.fields),
  });
  return Response.json({ run, brief }, { status: 201 });
}

/**
 * Resolve the portal-account label for the goal brief: the pre-flight answer
 * wins (and is remembered), otherwise fall back to the remembered label.
 */
async function resolvePortalAccount(
  businessId: string,
  agencyId: string,
  answers: { account_status?: unknown } | null | undefined
): Promise<"has_account" | "no_account" | "unknown"> {
  const answered = parseAccountStatusAnswer(answers?.account_status);
  if (answered) {
    await setPortalAccountStatus(businessId, agencyId, answered === "has_account");
    return answered;
  }
  return getPortalAccountStatus(businessId, agencyId);
}

/**
 * Keep only pre-flight field values whose id matches a missing item on the
 * action the human picked — the agent prompt must never receive arbitrary
 * client-supplied field ids. Values are trimmed and length-capped; empty
 * values are dropped so they become mid-run pauses as usual.
 */
function sanitizePreflightFields(
  action: AgencyAction,
  fields: Record<string, unknown> | null | undefined
): Record<string, string> | null {
  if (!fields || typeof fields !== "object") return null;
  const allowed = new Set((action.missing_items ?? []).map((m) => m.id));
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(fields)) {
    if (!allowed.has(id) || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out[id] = trimmed.slice(0, 512);
  }
  return Object.keys(out).length > 0 ? out : null;
}
