/**
 * Filing flow definitions — one agency × one filing variant.
 *
 * A flow is the executable contract Clara follows for a real portal:
 * every screen in order with the signals that identify it, the Business
 * Passport field map for its inputs, which steps are human-only, and how to
 * recover from known validation errors. It complements the playbook on the
 * filing config (what was recorded) with what is needed to act safely
 * (detect, map, recover). Labels and patterns only — never values.
 */
import type { PortalStepKind } from "../portalStep";

/** How to recognise a screen. Any heading match identifies it; the route
 * fragment and control are corroborating signals (and fixture contract). */
export interface FlowStepDetection {
  /** Visible heading patterns (EN + ES). */
  headings: RegExp[];
  /** URL path or hash fragment when the portal exposes one. */
  urlIncludes?: string[];
  /** One distinctive control label on the screen. */
  control: string;
}

/** Normalizers applied to passport values before they are typed in. */
export type FlowFieldNormalizer =
  | "text"
  | "email"
  | "phone_digits"
  | "entity_class"
  | "profit_type"
  | "name_designation";

export interface FlowField {
  id: string;
  label_en: string;
  label_es: string;
  type: "text" | "email" | "tel" | "number" | "select" | "checkbox";
  required: boolean;
  /** Business Passport path that fills this field (absent = ask the human or leave). */
  passportPath?: string;
  normalize?: FlowFieldNormalizer;
  /** Fixed value for this flow (e.g. jurisdiction for a domestic formation). */
  constant?: string;
  sensitive?: boolean;
}

/** A known validation message and what to do about it. */
export interface FlowRecovery {
  id: string;
  /** Matches the portal's validation text (EN or ES). */
  match: RegExp;
  fix_en: string;
  fix_es: string;
  /** Field to ask the human for when the fix needs a new value. */
  askField?: string;
}

export interface FlowStep {
  id: string;
  kind: PortalStepKind;
  title_en: string;
  title_es: string;
  detection: FlowStepDetection;
  fields: FlowField[];
  recovery: FlowRecovery[];
  /** Was this screen seen live (read-only walkthrough)? */
  observed: boolean;
  /** Where an unobserved screen's content comes from. */
  source: string;
}

export interface FilingFlow {
  filingType: string;
  /** Portal route that opens the flow. */
  entryRoute: string;
  steps: FlowStep[];
  /** Portal-wide recovery (session expiry, generic errors). */
  globalRecovery: FlowRecovery[];
  confirmation: { where_en: string; reference_en: string; pattern?: RegExp };
  /** Who the human pays at the payment step (display). */
  payee_en: string;
  payee_es: string;
}
