/**
 * Automated checks of the review-and-promote flow (Teach Clara spec §8):
 *
 *  1. sanitizationCheck — no values, credentials or PII outside the passport
 *     schema; selectors well-formed; all gates declared; no submit
 *     automation (validateSkill + a scan of every string in the skill).
 *  2. replay check — replay/virtualPortal.ts (virtualReplayCheck).
 *
 * Both must pass before an admin can approve a skill into the shared
 * library; the results are stored on the row with the approval.
 */
import type { Skill } from "./skill";
import { validateSkill } from "./skillValidate";
import { catalogEntry, isAdditionalPath } from "../teach/passportCatalog";
import { CANONICAL_LABELS } from "../canonicalFields";
import { virtualReplayCheck, type ReplayCheckResult } from "../replay/virtualPortal";

const EMAIL = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
const LONG_DIGITS = /\d[\d\s().-]{5,}\d/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;

export interface SanitizationResult {
  ok: boolean;
  findings: string[];
}

/** Every human-authored string in the skill, with where it came from. */
function strings(skill: Skill): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [
    { where: "portal.name", text: skill.portal.name },
    { where: "form", text: skill.form },
  ];
  for (const s of skill.steps) {
    const at = `step ${s.id}`;
    out.push({ where: `${at} label`, text: `${s.label.en} ${s.label.es}` });
    if (s.page_match.title_contains) out.push({ where: `${at} page_match`, text: s.page_match.title_contains });
    if (s.page_match.url_contains) out.push({ where: `${at} page_match`, text: s.page_match.url_contains });
    for (const r of s.rules ?? []) out.push({ where: `${at} rule`, text: r });
    if (s.note) out.push({ where: `${at} note`, text: s.note });
    for (const f of s.fields) {
      out.push({ where: `${at} field`, text: f.portal_field.label });
      if (f.portal_field.selector) out.push({ where: `${at} selector`, text: f.portal_field.selector });
      if (f.ask) out.push({ where: `${at} ask`, text: `${f.ask.en} ${f.ask.es}` });
      if (f.rule) out.push({ where: `${at} rule`, text: f.rule });
    }
    for (const a of s.actions) {
      out.push({ where: `${at} action`, text: a.target.label_contains });
      if (a.target.selector) out.push({ where: `${at} selector`, text: a.target.selector });
      if (a.rule) out.push({ where: `${at} rule`, text: a.rule });
    }
    for (const b of s.branches ?? []) if (b.when.equals !== undefined) out.push({ where: `${at} branch`, text: String(b.when.equals) });
  }
  return out;
}

function selectorProblem(sel: string): string | null {
  if (sel.length > 200) return "too long";
  if (/javascript:|<|>{2}|\bon\w+=/i.test(sel)) return "not a plain selector";
  if (/\[(value|data-value|placeholder)\b/i.test(sel)) return "quotes a value attribute";
  const balanced = (open: string, close: string) => sel.split(open).length === sel.split(close).length;
  if (!balanced("[", "]") || !balanced("(", ")")) return "unbalanced brackets";
  return null;
}

export function sanitizationCheck(skill: Skill): SanitizationResult {
  const findings = validateSkill(skill).map((e) => `schema: ${e.path} ${e.message}`);
  for (const { where, text: raw } of strings(skill)) {
    // ISO dates (evidence notes) and public agency addresses are not PII.
    const text = raw
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
      .replace(/[^\s@"]+@[^\s@"]+\.(gov|pr\.gov|gov\.pr)\b/gi, "");
    if (EMAIL.test(text)) findings.push(`${where}: looks like an email address`);
    if (SSN.test(text)) findings.push(`${where}: looks like a Social Security number`);
    else if (LONG_DIGITS.test(text) && !/nth-of-type/.test(text)) findings.push(`${where}: contains a long number (possible ID or phone)`);
    if (where.endsWith("selector")) {
      const p = selectorProblem(text);
      if (p) findings.push(`${where}: selector ${p}`);
    }
  }
  for (const s of skill.steps) {
    for (const f of s.fields) {
      if (f.passport_path && !catalogEntry(f.passport_path) && !(f.passport_path in CANONICAL_LABELS) && !isAdditionalPath(f.passport_path)) {
        findings.push(`step ${s.id} field "${f.portal_field.label}": ${f.passport_path} is not a Business Passport field`);
      }
    }
  }
  return { ok: findings.length === 0, findings };
}

export interface SkillChecks {
  sanitization: SanitizationResult;
  replay: ReplayCheckResult;
  ok: boolean;
  checkedAt: string;
}

export async function runSkillChecks(skill: Skill): Promise<SkillChecks> {
  const sanitization = sanitizationCheck(skill);
  const replay = await virtualReplayCheck(skill);
  return { sanitization, replay, ok: sanitization.ok && replay.ok, checkedAt: new Date().toISOString() };
}
