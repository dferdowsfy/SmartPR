/**
 * Flow registry, step detection, catalog reconciliation, passport field map
 * and prompt rendering for real portal flows.
 */
import type { AgencyPendingField } from "../types";
import type { AgencyPauseReason } from "../types";
import type { PauseState, PortalStep } from "../portalStep";
import { INLINE_STEPS, isCredentialField, resolvePauseState } from "../portalStep";
import { DEPT_STATE_CORPORATION_FLOW } from "./deptStateCorporation";
import type { FilingFlow, FlowField, FlowStep } from "./types";

export type { FilingFlow, FlowField, FlowStep } from "./types";

const FLOWS: Record<string, FilingFlow> = {
  [DEPT_STATE_CORPORATION_FLOW.filingType]: DEPT_STATE_CORPORATION_FLOW,
};

export function flowFor(filingType: string): FilingFlow | null {
  return FLOWS[filingType] ?? null;
}

/* ------------------------------------------------------------------ */
/* Step detection                                                      */
/* ------------------------------------------------------------------ */

/**
 * Identify the catalog step for what the browser shows. The visible
 * heading decides; a URL fragment alone identifies only when no heading
 * was reported. Returns null for an unrecognised screen.
 */
export function detectFlowStep(
  flow: FilingFlow,
  observed: { title?: string | null; url?: string | null }
): FlowStep | null {
  const title = (observed.title ?? "").trim();
  const url = (observed.url ?? "").trim();
  if (title) {
    const byHeading = flow.steps.filter((s) => s.detection.headings.some((re) => re.test(title)));
    if (byHeading.length === 1) return byHeading[0];
    if (byHeading.length > 1 && url) {
      const both = byHeading.filter((s) => s.detection.urlIncludes?.some((u) => url.includes(u)));
      if (both.length === 1) return both[0];
    }
    return byHeading.length === 1 ? byHeading[0] : null;
  }
  if (url) {
    const byUrl = flow.steps.filter((s) => s.detection.urlIncludes?.some((u) => url.includes(u)));
    if (byUrl.length === 1) return byUrl[0];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Catalog reconciliation                                              */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function matchCatalogField(step: FlowStep, field: AgencyPendingField): FlowField | null {
  const id = norm(field.id).replace(/ /g, "_");
  const label = norm(field.label);
  return (
    step.fields.find(
      (f) => f.id === id || norm(f.label_en) === label || norm(f.label_es) === label
    ) ?? null
  );
}

/**
 * Check a resolved pause against the flow catalog. The chat may only ask
 * for what the identified screen actually has:
 * - unrecognised screen (portal changed) → unknown
 * - reported kind contradicts the catalog step → unknown
 * - a data step whose requested fields are not that screen's fields → unknown
 * Otherwise the step takes the catalog's kind/title and the fields take the
 * catalog's labels, so chat and browser describe the same screen.
 */
export function reconcilePauseWithFlow(
  state: PauseState,
  flow: FilingFlow,
  observedUrl?: string | null
): PauseState & { flowStepId: string | null } {
  const { step, fields } = state;
  const unknown = (why: string): PauseState & { flowStepId: string | null } => ({
    step: { kind: "unknown", title: step.title, missing: [why], declared: step.declared },
    fields: [],
    flowStepId: null,
  });

  const catalog = detectFlowStep(flow, { title: step.title, url: observedUrl ?? step.url ?? null });
  if (!catalog) {
    // Uploads/captcha may legitimately appear on any screen without a heading.
    if (!step.title && (step.kind === "captcha" || step.kind === "upload")) {
      return { ...state, flowStepId: null };
    }
    return unknown("Screen not in the recorded flow");
  }

  // The agent may be vaguer than the catalog ("form" for a data screen is
  // consistent) but never different.
  const consistent =
    step.kind === catalog.kind ||
    (step.kind === "unknown" ? false : step.kind === "identity" && catalog.kind === "form") ||
    (step.kind === "certification" && catalog.kind === "signature");
  if (!consistent) {
    return unknown(`Reported "${step.kind}" but the screen is ${catalog.title_en}`);
  }

  const reconciledStep: PortalStep = {
    ...step,
    kind: catalog.kind,
    title: catalog.title_en,
  };

  if (!INLINE_STEPS.has(catalog.kind)) {
    return { step: reconciledStep, fields: [], flowStepId: catalog.id };
  }

  if (fields.some(isCredentialField)) return unknown("Credential field requested on a data screen");
  const mapped: AgencyPendingField[] = [];
  for (const f of fields) {
    const cf = matchCatalogField(catalog, f);
    if (!cf) return unknown(`"${f.label}" is not a field on ${catalog.title_en}`);
    mapped.push({ ...f, id: cf.id, label: cf.label_en, sensitive: f.sensitive || Boolean(cf.sensitive) });
  }
  if (mapped.length === 0) return unknown(`Nothing to ask on ${catalog.title_en}`);
  return { step: reconciledStep, fields: mapped, flowStepId: catalog.id };
}

/**
 * Resolve a pause for a specific filing: the generic step model first, then
 * — when the filing has a flow definition — the catalog check, so the chat
 * can only ask for what the identified screen has.
 */
export function resolvePauseForFiling(
  text: string,
  reason: AgencyPauseReason,
  filingType: string
): PauseState {
  const base = resolvePauseState(text, reason);
  const flow = flowFor(filingType);
  if (!flow) return base;
  const r = reconcilePauseWithFlow(base, flow);
  return { step: { ...r.step, flowStepId: r.flowStepId }, fields: r.fields };
}

/** Which recovery rule (step-specific first, then global) matches a portal message. */
export function recoveryFor(flow: FilingFlow, stepId: string | null, message: string) {
  const step = stepId ? flow.steps.find((s) => s.id === stepId) : undefined;
  return (
    step?.recovery.find((r) => r.match.test(message)) ??
    flow.globalRecovery.find((r) => r.match.test(message)) ??
    null
  );
}

/* ------------------------------------------------------------------ */
/* Business Passport field map                                         */
/* ------------------------------------------------------------------ */

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const ENTITY_CLASS: Record<string, string> = {
  corporation: "Corporation",
  stock_corporation: "Corporation",
  close_corporation: "Close Corporation",
  professional_corporation: "Professional Corporation",
};

const DESIGNATIONS: [RegExp, string][] = [
  [/\bincorporated\s*$/i, "Incorporated"],
  [/\binc\.?\s*$/i, "Inc."],
  [/\bcorporation\s*$/i, "Corporation"],
  [/\bcorp\.?\s*$/i, "Corp."],
];

/**
 * Passport value for a flow field, normalized for the portal. Returns null
 * when the passport cannot fill it — the agent must then ask (form step) or
 * leave it; it never invents a value.
 */
export function passportValueFor(field: FlowField, passport: Record<string, unknown> | null): string | null {
  if (field.constant) return field.constant;
  if (!field.passportPath || !passport) return null;
  const raw = getPath(passport, field.passportPath);
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  switch (field.normalize) {
    case "phone_digits": {
      const d = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      return d.length === 10 ? d : null;
    }
    case "email":
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v.toLowerCase() : null;
    case "entity_class":
      return ENTITY_CLASS[v.toLowerCase()] ?? null;
    case "profit_type":
      return /nonprofit|non_profit|sin fines/i.test(v) ? "Non-Profit" : ENTITY_CLASS[v.toLowerCase()] ? "For Profit" : null;
    case "name_designation":
      return DESIGNATIONS.find(([re]) => re.test(v))?.[1] ?? null;
    default:
      return v;
  }
}

/** Every field on a step with its passport value (null = must be asked / left). */
export function fieldMapForStep(step: FlowStep, passport: Record<string, unknown> | null) {
  return step.fields.map((f) => ({ field: f, value: passportValueFor(f, passport) }));
}

/* ------------------------------------------------------------------ */
/* Prompt block                                                         */
/* ------------------------------------------------------------------ */

/**
 * STEP CATALOG + FIELD MAP + RECOVERY for the agent. Values come from the
 * sensitive-stripped passport the prompt already embeds; human-only steps
 * list no fields.
 */
export function renderFlowForPrompt(flow: FilingFlow, passport: Record<string, unknown> | null): string {
  const lines: string[] = [
    `STEP CATALOG (identify each screen by its heading BEFORE acting; entry route ${flow.entryRoute}). If the heading matches none of these, or contradicts what you expected, pause with PORTAL_STEP kind=unknown — never guess.`,
  ];
  flow.steps.forEach((s, i) => {
    const signals = [
      `heading "${s.title_en}"`,
      s.detection.urlIncludes?.length ? `url contains ${s.detection.urlIncludes.map((u) => `"${u}"`).join(" or ")}` : null,
      `control "${s.detection.control}"`,
    ].filter(Boolean).join("; ");
    lines.push(`${i + 1}. ${s.id} — kind=${s.kind} — ${signals}${s.observed ? "" : " — NOT yet observed live: confirm the screen before acting"}`);
    for (const { field, value } of fieldMapForStep(s, passport)) {
      const src = field.constant
        ? `use exactly: ${field.constant}`
        : value !== null
          ? `from passport ${field.passportPath}: ${value}`
          : field.passportPath
            ? `passport ${field.passportPath} is empty or unusable — ${field.required ? "ask the human (REQUIRED_FIELDS)" : "leave blank"}`
            : field.required
              ? "not in the passport — ask the human (REQUIRED_FIELDS)"
              : "optional — leave blank unless the human provided it";
      lines.push(`   - FIELD ${field.id} ("${field.label_en}"): ${src}`);
    }
    for (const r of s.recovery) lines.push(`   - IF the portal says /${r.match.source}/: ${r.fix_en}`);
  });
  lines.push("PORTAL-WIDE RECOVERY:");
  for (const r of flow.globalRecovery) lines.push(`   - IF /${r.match.source}/: ${r.fix_en}`);
  lines.push(
    `PAYMENT: the human pays ${flow.payee_en} directly in the portal's own payment step. Report PORTAL_STEP kind=payment with amount=<the total the portal shows>. Never enter card details, never choose a payment method, never pay.`,
    `CONFIRMATION: ${flow.confirmation.where_en} — report SUBMITTED:<reference> (${flow.confirmation.reference_en}) only after the HUMAN submitted.`
  );
  return lines.join("\n");
}
