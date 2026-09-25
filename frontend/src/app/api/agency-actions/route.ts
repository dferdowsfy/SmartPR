/**
 * Agency actions API — the filing-first agency assistant flow.
 *
 * GET /api/agency-actions/filings?business_id=...[&demo=1]
 *   → { groups: FilingGroup[] } — obligation-joined filing options (see
 *     ./filings/route.ts).
 *
 * GET /api/agency-actions?business_id=...&agency=HACIENDA_SURI
 *   → { actions: AgencyAction[] } — legacy registry-only readiness (kept for
 *     compatibility; the chat UI no longer calls it).
 *
 * POST /api/agency-actions { business_id, action_id, obligation_id }
 *   → resolves the SmartPR obligation, validates it maps to the requested
 *     filing (server-side — the client can never invent an objective), builds
 *     the labels-only goal brief + structured submission objective, and
 *     starts an agency run. Responds 201 { run: AgencyRunPublic, brief }.
 *     No browser session starts without a specific filing objective.
 */
import { randomUUID } from "crypto";
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
  type FilingOption,
} from "../../../lib/agency-runs/agencyActions";
import { getFilingConfig } from "../../../lib/agency-runs/filingTypes";
import { buildGoalBrief } from "../../../lib/agency-runs/goalBrief";
import { loadPassportForBusiness } from "../../../lib/agency-runs/passportLoader";
import { loadProjectContextForBusiness, loadProjectIntentForBusiness } from "../../../lib/agency-runs/projectContextLoader";
import { parseAccountStatusAnswer } from "../../../lib/agency-runs/preflight";
import {
  getPortalAccountStatus,
  setPortalAccountStatus,
} from "../../../lib/agency-runs/portalAccounts";
import type { SubmissionObjective } from "../../../lib/agency-runs/types";
import { getCurrentUser } from "../../../lib/supabase/server";
import { filingsFor } from "./filings/route";

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
    /**
     * SmartPR obligation this filing fulfills (required). Server-resolved
     * from the business's obligations — the client can never invent an
     * objective, only pick one SmartPR already identified.
     */
    obligation_id?: string;
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
  const obligationId = String(body.obligation_id || "").trim();

  if (!businessId) {
    return Response.json({ error: "business_id is required." }, { status: 400 });
  }
  if (!actionId || !isFilingType(actionId)) {
    return Response.json({ error: "action_id must be a known filing type." }, { status: 400 });
  }
  // No browser session without a specific SmartPR filing requirement.
  if (!obligationId) {
    return Response.json({ error: "obligation_id is required." }, { status: 400 });
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

  // Resolve the obligation server-side and verify it actually maps to the
  // requested filing (same anti-injection pattern as objective_en below).
  const groups = await filingsFor(businessId, user?.id ?? null);
  const candidates: FilingOption[] = [];
  for (const group of groups) {
    for (const filing of group.filings) {
      if (
        filing.supported &&
        filing.action &&
        filing.action.filing_type === actionId &&
        filing.obligation_id === obligationId
      ) {
        candidates.push(filing);
      }
    }
  }
  if (candidates.length === 0) {
    // The filing exists for this requirement but cannot start (disabled or
    // its launch switch is off) — say so instead of "not found".
    const notAvailable = groups.some((g) =>
      g.filings.some(
        (f) =>
          f.filing_status === "not_available" &&
          f.action?.filing_type === actionId &&
          f.obligation_id === obligationId
      )
    );
    if (notAvailable) {
      return Response.json(
        { error: "This filing is not available to start yet.", code: "filing_not_available" },
        { status: 409 }
      );
    }
    return Response.json(
      { error: "obligation not found for this filing." },
      { status: 404 }
    );
  }
  const option = candidates[0];

  // When one filing type resolves to multiple objective variants (e.g. Dept.
  // of State new-entity vs annual report), honor the variant the human picked
  // in chat — but only if it matches a server-resolved objective. Never take
  // free-form objective text from the client into the agent prompt.
  const requestedObjective = String(body.objective_en || "").trim();
  const picked =
    candidates.find((f) => f.action?.objective_en === requestedObjective) ?? option;
  const action = picked.action;
  if (!action) {
    return Response.json({ error: "action not found for this business." }, { status: 404 });
  }

  // Never launch for a filing that's already submitted, still blocked, or
  // not required. Missing SmartPR information does NOT block — the
  // assistant asks for the missing items during the run.
  if (picked.filing_status === "submitted") {
    return Response.json(
      { error: "This filing was already submitted — a new browser run cannot start for it." },
      { status: 409 }
    );
  }
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
    action,
    objective_en: action.objective_en,
    objective_es: action.objective_es,
    portal_account: await resolvePortalAccount(businessId, agencyId, body.preflight_answers),
    // Project-context facts from the latest intake snapshot (background
    // only — the brief marks them as never driving requirement decisions).
    project_context:
      (await loadProjectContextForBusiness(businessId, user?.id ?? null)) ?? undefined,
    // Intake branch for this filing (labels only in the prompt block).
    project_intent:
      (await loadProjectIntentForBusiness(businessId, user?.id ?? null)) ?? undefined,
  });

  // Structured submission objective — the browser agent executes ONLY this.
  // Labels/ids only; the run (and its task prompt) carry it, and createRun
  // refuses to create the run when ready_to_start is false.
  const objective: SubmissionObjective = {
    submission_objective_id: randomUUID(),
    business_id: businessId,
    requirement_id: picked.requirement_id,
    requirement_name: picked.obligation_name,
    obligation_id: picked.obligation_id,
    obligation_status: picked.obligation_status,
    agency: config.agencyEn,
    transaction_type: action.filing_type,
    target_portal: `${config.portalEn} (${config.startUrl})`,
    approved_fields: config.passportCoverageKeys ?? [],
    approved_documents: config.evidenceTags ?? [],
    ready_to_start: true,
  };

  const passport = await loadPassportForBusiness(businessId, user?.id ?? null);
  const run = await createRun({
    business_id: businessId,
    filing_type: action.filing_type,
    owner_user_id: user?.id ?? null,
    passport,
    goalBrief: brief,
    submissionObjective: objective,
    fields: sanitizePreflightFields(action, body.preflight_answers?.fields),
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
