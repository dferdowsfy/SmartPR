// Links into the Clara workspace (/businesses/<id>/agency-run) for a
// requirement: mode=teach ("Teach Clara" — record the routine once) or
// mode=fill ("Fill with Clara" — replay a routine she already learned).
// The requirement's context travels in the query so the workspace opens
// ready: requirement key + name, agency, filing goal and portal address.
// Business values never go in the URL — the workspace loads the Business
// Passport server side.

import type { GuidedSubject } from "./guidedFormModel";

export type ClaraWorkspaceMode = "teach" | "fill";

export interface ClaraWorkspaceContext {
  mode: ClaraWorkspaceMode;
  requirementKey: string;
  name: string;
  agency: string | null;
  portalUrl: string | null;
  /** What the filing should accomplish (defaults to the requirement name). */
  goal: string | null;
  /** fill: the learned routine to replay. */
  routineRef: string | null;
}

/** A local intake draft has no saved business yet: teaching still works (no Passport). */
export const NO_BUSINESS_ID = "local-workspace";

export function claraWorkspaceHref(
  mode: ClaraWorkspaceMode,
  businessId: string | null,
  subject: Pick<GuidedSubject, "key" | "name" | "agency" | "portalUrl">,
  extra: { goal?: string | null; routineRef?: string | null } = {}
): string {
  const q = new URLSearchParams({ mode, requirement: subject.key, name: subject.name });
  if (subject.agency) q.set("agency", subject.agency);
  if (subject.portalUrl && /^https:\/\//i.test(subject.portalUrl)) q.set("portal", subject.portalUrl);
  if (extra.goal) q.set("goal", extra.goal);
  if (extra.routineRef) q.set("routine", extra.routineRef);
  return `/businesses/${encodeURIComponent(businessId || NO_BUSINESS_ID)}/agency-run?${q}`;
}

export function parseClaraWorkspace(search: string): ClaraWorkspaceContext | null {
  const q = new URLSearchParams(search);
  const mode = q.get("mode");
  if (mode !== "teach" && mode !== "fill") return null;
  const requirementKey = (q.get("requirement") ?? "").slice(0, 120);
  const name = (q.get("name") ?? "").slice(0, 200);
  const portal = q.get("portal");
  return {
    mode,
    requirementKey,
    name: name || requirementKey,
    agency: q.get("agency")?.slice(0, 120) || null,
    portalUrl: portal && /^https:\/\//i.test(portal) ? portal.slice(0, 600) : null,
    goal: q.get("goal")?.slice(0, 300) || null,
    routineRef: q.get("routine")?.slice(0, 200) || null,
  };
}

export function isPersistedBusinessId(id: string | null | undefined): id is string {
  return Boolean(id) && !String(id).startsWith("local-");
}
