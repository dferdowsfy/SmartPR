/**
 * Clara filing skills (Teach Clara spec §4) — types, the human-gate
 * registry, and field transforms.
 *
 * A skill is the reusable structure of one agency-portal filing: page
 * sequence, clicks, portal_field → passport_path mappings, conditional
 * branches and human gates. It never stores credentials, MFA codes or
 * entered values; values come from the Business Passport at replay.
 * Validation lives in skillValidate.ts.
 */

export type SkillFallback = "pause_and_ask" | "skip_step" | "abort_run";
export type SkillTransform = null | "trim" | "strip_formatting" | "digits_only" | "uppercase";

export interface BilingualText {
  en: string;
  es: string;
}

export interface SkillTarget {
  role: "button" | "link" | "radio" | "checkbox" | "combobox" | "option" | "tab";
  label_contains: string;
  selector?: string | null;
}

export interface SkillAction {
  type: "click";
  target: SkillTarget;
  rule?: string;
  fallback: SkillFallback;
}

export interface SkillField {
  portal_field: { label: string; selector?: string | null; role?: "textbox" | "combobox" };
  /** null = unmapped: Clara never fills it, she pauses and asks. */
  passport_path: string | null;
  ask?: BilingualText;
  transform: SkillTransform;
  required: boolean;
  rule?: string;
  fallback: SkillFallback;
}

export interface SkillBranch {
  when: { passport_has: string; equals?: string | number | boolean };
  goto_step: string;
  note?: string;
}

export interface SkillGate {
  id: string;
  type: "human" | "pause";
  note?: string;
  handoff?: BilingualText;
}

export interface SkillStep {
  id: string;
  label: BilingualText;
  page_match: { url_contains?: string; title_contains?: string };
  gate?: string;
  observed: boolean;
  fallback: SkillFallback;
  rules?: string[];
  actions: SkillAction[];
  fields: SkillField[];
  branches?: SkillBranch[];
  note?: string;
}

export interface Skill {
  $schema?: string;
  skill_id: string;
  version: number;
  /** base_url's host is the site the skill is for (and the replay's allowed domain). */
  portal: { name: string; base_url: string };
  form: string;
  /** Optional link to a hand-written filing config; taught skills for any
   *  other site omit it and match on portal host + form. */
  filing_type_id?: string | null;
  taught_by: "admin" | "partner" | "user";
  scope: "shared" | "private";
  status: "draft" | "in_review" | "approved" | "rejected" | "needs_reteach";
  steps: SkillStep[];
  gates: SkillGate[];
}

/**
 * Gates every skill must declare as `type: "human"` (spec §3; verified
 * 2026-09-28 — never regress). Clara never acts at any of them.
 */
export const REQUIRED_HUMAN_GATES = [
  "login",
  "mfa",
  "captcha",
  "certification",
  "signature",
  "payment",
  "submit",
] as const;

/** Apply a field transform to a passport value at replay. */
export function applyTransform(value: string, transform: SkillTransform): string {
  switch (transform) {
    case null:
      return value;
    case "trim":
      return value.trim();
    case "strip_formatting":
      return value.replace(/[\s().\-/+]/g, "");
    case "digits_only":
      return value.replace(/\D/g, "");
    case "uppercase":
      return value.toUpperCase();
  }
}
