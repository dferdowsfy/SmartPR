/**
 * Monthly compliance-digest email templates (English + Puerto Rican Spanish).
 *
 * The digest behaves like a proactive compliance officer: executive summary,
 * ACTION REQUIRED, COMING UP, WHAT CHANGED, SMARTPR NEEDS FROM YOU, and
 * COMPLIANCE HEALTH. Only relevant sections render.
 *
 * Pure functions: buildDigestEmail() takes the digest facts and returns
 * { subject, text, html }. Sending lives in the cron route; this module never
 * touches the network so it is trivially unit-testable.
 *
 * Branding follows getsmartpr.com: warm paper #f4f1ea, ink #161616, brand
 * deep teal #245c5c, IBM Plex Sans. Voice: plain, direct, warm.
 *
 * Spanish copy is boricua Spanish — direct, warm, "radica", "se te vence",
 * "ponte al día" — never neutral/LatAm phrasing.
 *
 * Founder rules enforced by construction:
 * - The digest never invents a date, change, or applicability. Items without
 *   a stored date never show one; developments appear only with a cited
 *   source and an explainable match basis.
 * - No business is ever hard-coded; every name comes from the input.
 */

import {
  applicabilityLabelCopy,
  confidenceCopy,
  type ApplicabilityLabel,
  type DevelopmentConfidence,
  type DigestLang,
} from "./compliance-regulatory";

export interface DigestActionItem {
  obligationId: string;
  name: string;
  businessName: string;
  businessRef: string;
  agency: string | null;
  /** YYYY-MM-DD, always a stored date with provenance — never invented. Null for stalled items. */
  dueDate: string | null;
  /** Negative = overdue. Null for stalled items. */
  daysRemaining: number | null;
  daysStalled: number | null;
  overdue: boolean;
  /** Localized: what needs to happen (graph guidance nextAction or fallback). */
  whatToDo: string;
  /** Localized: why it applies (graph guidance regulatoryReason or fallback). */
  whyApplies: string;
  /** Localized: risk of missing it (graph guidance consequence or honest generic). */
  risk: string;
  applicability: ApplicabilityLabel;
  actionUrl: string;
}

export interface DigestComingItem {
  obligationId: string;
  name: string;
  businessName: string;
  businessRef: string;
  agency: string | null;
  dueDate: string;
  daysRemaining: number;
  /** Localized: what preparation should begin now. */
  prepNow: string;
  applicability: ApplicabilityLabel;
  actionUrl: string;
  /** 31–60 days → "60", 61–90 days → "90". */
  window: "60" | "90";
}

export interface DigestChangeItem {
  developmentId: string;
  title: string;
  summary: string;
  businessName: string;
  effectiveDate: string | null;
  publishedDate: string | null;
  /** Localized: why it affects THIS business (match basis + notes). */
  whyAffects: string;
  recommendedAction: string | null;
  sourceName: string;
  sourceUrl: string;
  confidence: DevelopmentConfidence;
  applicability: ApplicabilityLabel;
}

export type DigestNeedKind = "evidence" | "date" | "info";

export interface DigestNeedItem {
  kind: DigestNeedKind;
  name: string;
  businessName: string;
  businessRef: string;
  agency: string | null;
  /** Localized: what SmartPR needs and why. */
  detail: string;
  /** Localized CTA label. */
  cta: string;
  actionUrl: string;
}

export interface DigestHealth {
  percent: number;
  total: number;
  current: number;
  upcoming: number;
  needsVerification: number;
  overdue: number;
}

export interface DigestEmailInput {
  lang: DigestLang;
  /** e.g. "OAFA Rubber" for one business, "3 businesses" for several. */
  businessLabel: string;
  /** e.g. "October 2026" / "octubre de 2026" */
  monthLabel: string;
  userName: string | null;
  /** Counts for the executive summary (pre-cap). */
  actionCount: number;
  upcomingCount: number;
  changeCount: number;
  actionRequired: DigestActionItem[];
  comingUp: DigestComingItem[];
  changes: DigestChangeItem[];
  needsFromYou: DigestNeedItem[];
  health: DigestHealth;
  /** Items beyond the display caps, per section. */
  overflow: { action: number; coming: number; changes: number; needs: number };
  dashboardUrl: string;
  complianceCenterUrl: string;
  manageUrl: string;
  unsubscribeUrl: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Pure: which COMING UP window does a days-remaining value belong to? */
export function bucketComingItem(daysRemaining: number): "60" | "90" | null {
  if (daysRemaining >= 31 && daysRemaining <= 60) return "60";
  if (daysRemaining >= 61 && daysRemaining <= 90) return "90";
  return null;
}

/** Pure: soonest first (overdue items, most negative, come first). */
export function sortDigestSoonestFirst<T extends { daysRemaining: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/** Back-compat alias used by the daily-reminder digest bucketing. */
export function bucketDigestItem(daysRemaining: number): "dueSoon" | "dueLater" | null {
  if (daysRemaining <= 30) return "dueSoon";
  if (daysRemaining <= 90) return "dueLater";
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatDateLong(iso: string, lang: DigestLang): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "es" ? "es-PR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysLabel(days: number, lang: DigestLang): string {
  if (lang === "es") {
    if (days < 0) return days === -1 ? "vencido hace 1 día" : `vencido hace ${-days} días`;
    if (days === 0) return "se vence hoy";
    if (days === 1) return "en 1 día";
    return `en ${days} días`;
  }
  if (days < 0) return days === -1 ? "overdue by 1 day" : `overdue by ${-days} days`;
  if (days === 0) return "due today";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

function stalledLabel(days: number, lang: DigestLang): string {
  return lang === "es" ? `sin moverse hace ${days} días` : `idle for ${days} days`;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const FONT = `'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

interface Copy {
  headline: string;
  greeting: string;
  allClearTitle: string;
  allClearBody: string;
  actionTitle: string;
  comingTitle: string;
  coming60: string;
  coming90: string;
  changedTitle: string;
  changedFallback: string;
  needsTitle: string;
  healthTitle: string;
  healthCurrent: string;
  reviewRequirement: string;
  openComplianceCenter: string;
  openDashboard: string;
  footer: string;
  manageLabel: string;
  unsubLabel: string;
  moreInApp: (n: number) => string;
  whatToDo: string;
  whyApplies: string;
  riskLabel: string;
  prepNowLabel: string;
  whyAffects: string;
  recommendedAction: string;
  effectiveDate: string;
  source: string;
  whatChanged: string;
}

function copyFor(lang: DigestLang): Copy {
  if (lang === "es") {
    return {
      headline: "Resumen mensual de cumplimiento",
      greeting: "Hola",
      allClearTitle: "Todo al día",
      allClearBody: "Nada requiere acción inmediata y no hay vencimientos en los próximos 90 días. Así se ve ir alante.",
      actionTitle: "Requiere acción",
      comingTitle: "Lo que viene",
      coming60: "En los próximos 60 días",
      coming90: "En los próximos 90 días",
      changedTitle: "Lo que cambió",
      changedFallback: "Este mes no se identificaron cambios regulatorios materiales que afecten tu perfil de SmartPR.",
      needsTitle: "SmartPR necesita de ti",
      healthTitle: "Salud de cumplimiento",
      healthCurrent: "al día",
      reviewRequirement: "Revisar requisito",
      openComplianceCenter: "Abrir el Centro de Cumplimiento",
      openDashboard: "Abrir SmartPR",
      footer: "Recibes el resumen mensual porque tienes los avisos activados.",
      manageLabel: "Manejar preferencias",
      unsubLabel: "Darme de baja de todos los avisos",
      moreInApp: (n) => `+${n} más en SmartPR`,
      whatToDo: "Qué hay que hacer",
      whyApplies: "Por qué te aplica",
      riskLabel: "Si se te pasa",
      prepNowLabel: "Empieza ahora",
      whyAffects: "Por qué te afecta",
      recommendedAction: "Acción recomendada",
      effectiveDate: "Vigente desde",
      source: "Fuente",
      whatChanged: "Qué cambió",
    };
  }
  return {
    headline: "Monthly compliance digest",
    greeting: "Hi",
    allClearTitle: "All clear",
    allClearBody: "Nothing needs immediate action and nothing is due in the next 90 days. This is what staying ahead looks like.",
    actionTitle: "Action required",
    comingTitle: "Coming up",
    coming60: "Within 60 days",
    coming90: "Within 90 days",
    changedTitle: "What changed",
    changedFallback: "No material regulatory changes affecting your SmartPR profile were identified this month.",
    needsTitle: "SmartPR needs from you",
    healthTitle: "Compliance health",
    healthCurrent: "current",
    reviewRequirement: "Review Requirement",
    openComplianceCenter: "Open Compliance Center",
    openDashboard: "Open SmartPR",
    footer: "You're getting the monthly digest because reminders are on for your account.",
    manageLabel: "Manage preferences",
    unsubLabel: "Unsubscribe from all reminder emails",
    moreInApp: (n) => `+${n} more in SmartPR`,
    whatToDo: "What needs to happen",
    whyApplies: "Why it applies to you",
    riskLabel: "If you miss it",
    prepNowLabel: "Start now",
    whyAffects: "Why it affects you",
    recommendedAction: "Recommended action",
    effectiveDate: "Effective",
    source: "Source",
    whatChanged: "What changed",
  };
}

/** 2–3 sentence executive summary generated from counts. */
export function executiveSummary(
  lang: DigestLang,
  actionCount: number,
  upcomingCount: number,
  changeCount: number
): string {
  const parts: string[] = [];
  if (lang === "es") {
    if (actionCount > 0) parts.push(`Tienes ${actionCount} ${actionCount === 1 ? "acción que requiere" : "acciones que requieren"} atención`);
    if (upcomingCount > 0) parts.push(`${upcomingCount} ${upcomingCount === 1 ? "requisito próximo" : "requisitos próximos"} en los próximos 90 días`);
    if (changeCount > 0) parts.push(`${changeCount} ${changeCount === 1 ? "cambio regulatorio" : "cambios regulatorios"} que ${changeCount === 1 ? "puede afectar" : "pueden afectar"} tu operación`);
    if (parts.length === 0) return "Todo está al día: sin acciones pendientes, sin vencimientos próximos y sin cambios regulatorios que te afecten.";
    return `${parts.join(", ")}. Ponte al día con lo más urgente primero.`;
  }
  if (actionCount > 0) parts.push(`You have ${actionCount} ${actionCount === 1 ? "action" : "actions"} requiring attention`);
  if (upcomingCount > 0) parts.push(`${upcomingCount} ${upcomingCount === 1 ? "requirement" : "requirements"} approaching within 90 days`);
  if (changeCount > 0) parts.push(`${changeCount} regulatory ${changeCount === 1 ? "development" : "developments"} that may affect your operation`);
  if (parts.length === 0) return "Everything is current: no pending actions, no upcoming deadlines, and no regulatory changes affecting you.";
  return `${parts.join(", ")}. Start with the most urgent first.`;
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

const PAPER = "#f4f1ea";
const INK = "#161616";
const TEAL = "#245c5c";
const MUTED = "#5c5c5c";

function labelChip(label: ApplicabilityLabel, lang: DigestLang): string {
  const styles: Record<ApplicabilityLabel, string> = {
    confirmed: `background:#e6f0ec;color:${TEAL};`,
    likely: `background:#fdf3e3;color:#8a5a00;`,
    conditional: `background:#f0ede6;color:#6b6257;`,
  };
  return `<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;${styles[label]}">${escapeHtml(applicabilityLabelCopy(label, lang))}</span>`;
}

function daysChip(days: number, lang: DigestLang): string {
  const base = "display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;";
  const style = days <= 7 ? `${base}background:#fbe3e3;color:#a02a2a;` : days <= 30 ? `${base}background:#fdf3e3;color:#8a5a00;` : `${base}background:#e6f0ec;color:${TEAL};`;
  return `<span style="${style}">${escapeHtml(daysLabel(days, lang))}</span>`;
}

function itemHead(name: string, url: string, meta: string, rightHtml: string): string {
  return (
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">` +
    `<div style="min-width:0;">` +
    `<a href="${escapeHtml(url)}" style="color:${INK};font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(name)}</a>` +
    `<div style="font-size:12px;color:${MUTED};margin-top:4px;">${meta}</div>` +
    `</div><div style="text-align:right;flex-shrink:0;">${rightHtml}</div></div>`
  );
}

function factRow(label: string, value: string): string {
  return `<div style="font-size:13px;line-height:1.55;margin-top:8px;"><span style="font-weight:700;color:${INK};">${escapeHtml(label)}:</span> <span style="color:#2b2b2b;">${escapeHtml(value)}</span></div>`;
}

function ctaButton(url: string, label: string): string {
  return `<div style="margin-top:12px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 20px;border-radius:8px;">${escapeHtml(label)}</a></div>`;
}

function card(inner: string): string {
  return `<div style="background:#ffffff;border:1px solid #e3ddd0;border-radius:12px;padding:16px;margin:0 0 14px;">${inner}</div>`;
}

function sectionShell(title: string, inner: string): string {
  return `<div style="margin:0 0 20px;"><div style="font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${TEAL};margin-bottom:10px;">${escapeHtml(title)}</div>${inner}</div>`;
}

function overflowLine(n: number, c: Copy): string {
  if (n <= 0) return "";
  return `<div style="font-size:12px;color:${MUTED};text-align:center;margin:-6px 0 14px;">${escapeHtml(c.moreInApp(n))}</div>`;
}

function actionItemHtml(item: DigestActionItem, c: Copy, lang: DigestLang): string {
  const metaParts = [escapeHtml(item.businessName)];
  if (item.agency) metaParts.push(escapeHtml(item.agency));
  const meta = metaParts.join(" · ");
  const timing = item.overdue || item.daysRemaining !== null
    ? `<div style="margin-bottom:8px;">${daysChip(item.daysRemaining ?? 0, lang)}</div><div style="font-size:12px;color:${MUTED};margin-top:4px;">${item.dueDate ? escapeHtml(formatDateLong(item.dueDate, lang)) : ""}</div>`
    : `<div style="margin-bottom:8px;"><span style="display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;background:#f0ede6;color:#6b6257;">${escapeHtml(stalledLabel(item.daysStalled ?? 0, lang))}</span></div>`;
  const right = `${timing}<div style="margin-top:6px;">${labelChip(item.applicability, lang)}</div>`;
  return card(
    itemHead(item.name, item.actionUrl, meta, right) +
    factRow(c.whatToDo, item.whatToDo) +
    factRow(c.whyApplies, item.whyApplies) +
    factRow(c.riskLabel, item.risk) +
    ctaButton(item.actionUrl, c.reviewRequirement)
  );
}

function comingItemHtml(item: DigestComingItem, c: Copy, lang: DigestLang): string {
  const metaParts = [escapeHtml(item.businessName)];
  if (item.agency) metaParts.push(escapeHtml(item.agency));
  const right = `<div style="margin-bottom:8px;">${daysChip(item.daysRemaining, lang)}</div><div style="font-size:12px;color:${MUTED};margin-top:4px;">${escapeHtml(formatDateLong(item.dueDate, lang))}</div><div style="margin-top:6px;">${labelChip(item.applicability, lang)}</div>`;
  return card(
    itemHead(item.name, item.actionUrl, metaParts.join(" · "), right) +
    factRow(c.prepNowLabel, item.prepNow)
  );
}

function changeItemHtml(item: DigestChangeItem, c: Copy, lang: DigestLang): string {
  const rows: string[] = [];
  rows.push(`<div style="font-size:14px;color:#2b2b2b;line-height:1.55;margin-top:6px;">${escapeHtml(item.summary)}</div>`);
  rows.push(factRow(c.whyAffects, item.whyAffects));
  if (item.recommendedAction) rows.push(factRow(c.recommendedAction, item.recommendedAction));
  const metaBits: string[] = [];
  if (item.effectiveDate) metaBits.push(`${c.effectiveDate}: ${formatDateLong(item.effectiveDate, lang)}`);
  else if (item.publishedDate) metaBits.push(formatDateLong(item.publishedDate, lang));
  metaBits.push(`${c.source}: ${item.sourceName}`);
  const head =
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">` +
    `<div style="min-width:0;"><a href="${escapeHtml(item.sourceUrl)}" style="color:${INK};font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(item.title)}</a>` +
    `<div style="font-size:12px;color:${MUTED};margin-top:4px;">${escapeHtml(item.businessName)} · ${metaBits.map(escapeHtml).join(" · ")}</div></div>` +
    `<div style="text-align:right;flex-shrink:0;"><div style="margin-bottom:6px;">${labelChip(item.applicability, lang)}</div>` +
    `<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:#f0ede6;color:#6b6257;">${escapeHtml(confidenceCopy(item.confidence, lang))}</span></div></div>`;
  rows.unshift(head);
  return card(rows.join(""));
}

function needItemHtml(item: DigestNeedItem, c: Copy, lang: DigestLang): string {
  const metaParts = [escapeHtml(item.businessName)];
  if (item.agency) metaParts.push(escapeHtml(item.agency));
  return card(
    itemHead(item.name, item.actionUrl, metaParts.join(" · "), "") +
    `<div style="font-size:13px;color:#2b2b2b;line-height:1.55;margin-top:8px;">${escapeHtml(item.detail)}</div>` +
    ctaButton(item.actionUrl, item.cta)
  );
}

export function buildDigestEmail(input: DigestEmailInput): BuiltEmail {
  const { lang } = input;
  const c = copyFor(lang);
  const greeting = input.userName ? `${c.greeting} ${input.userName},` : `${c.greeting},`;
  const subject = lang === "es"
    ? `SmartPR: tu resumen de cumplimiento — ${input.businessLabel} — ${input.monthLabel}`
    : `SmartPR Monthly Compliance Digest — ${input.businessLabel} — ${input.monthLabel}`;

  const hasContent =
    input.actionRequired.length > 0 ||
    input.comingUp.length > 0 ||
    input.changes.length > 0 ||
    input.needsFromYou.length > 0;
  const summary = executiveSummary(lang, input.actionCount, input.upcomingCount, input.changeCount);

  // ------------------------------------------------------------------ text --
  const t: string[] = [`SMARTPR MONTHLY COMPLIANCE DIGEST — ${input.businessLabel} — ${input.monthLabel}`, "", greeting, "", summary, ""];
  if (input.actionRequired.length) {
    t.push(c.actionTitle.toUpperCase());
    for (const i of input.actionRequired) {
      t.push(`• ${i.name} (${i.businessName}${i.agency ? ` · ${i.agency}` : ""}) — ${i.daysRemaining !== null ? daysLabel(i.daysRemaining, lang) : stalledLabel(i.daysStalled ?? 0, lang)}`);
      t.push(`  ${c.whatToDo}: ${i.whatToDo}`);
      t.push(`  ${c.whyApplies}: ${i.whyApplies}`);
      t.push(`  ${c.riskLabel}: ${i.risk}`);
    }
    t.push("");
  }
  if (input.comingUp.length) {
    t.push(c.comingTitle.toUpperCase());
    for (const i of input.comingUp) t.push(`• ${i.name} — ${i.dueDate} (${daysLabel(i.daysRemaining, lang)}). ${c.prepNowLabel}: ${i.prepNow}`);
    t.push("");
  }
  t.push(c.changedTitle.toUpperCase());
  if (input.changes.length) {
    for (const ch of input.changes) {
      t.push(`• ${ch.title} — ${ch.sourceName}${ch.effectiveDate ? ` (${c.effectiveDate}: ${ch.effectiveDate})` : ""}`);
      t.push(`  ${c.whyAffects}: ${ch.whyAffects}`);
      if (ch.recommendedAction) t.push(`  ${c.recommendedAction}: ${ch.recommendedAction}`);
    }
  } else {
    t.push(c.changedFallback);
  }
  t.push("");
  if (input.needsFromYou.length) {
    t.push(c.needsTitle.toUpperCase());
    for (const n of input.needsFromYou) t.push(`• ${n.name} (${n.businessName}): ${n.detail}`);
    t.push("");
  }
  const h = input.health;
  t.push(
    c.healthTitle.toUpperCase(),
    `${h.percent}% ${c.healthCurrent} — ${h.current}/${h.total}`
  );
  t.push(
    `${c.openComplianceCenter}: ${input.complianceCenterUrl}`,
    "",
    c.footer,
    `${c.manageLabel}: ${input.manageUrl}`,
    `${c.unsubLabel}: ${input.unsubscribeUrl}`
  );

  // ------------------------------------------------------------------- html --
  const sections: string[] = [];

  if (input.actionRequired.length) {
    sections.push(
      sectionShell(c.actionTitle, input.actionRequired.map((i) => actionItemHtml(i, c, lang)).join("") + overflowLine(input.overflow.action, c))
    );
  }

  if (input.comingUp.length) {
    const w60 = input.comingUp.filter((i) => i.window === "60");
    const w90 = input.comingUp.filter((i) => i.window === "90");
    let inner = "";
    if (w60.length) inner += `<div style="font-size:13px;font-weight:700;color:${INK};margin:0 0 8px;">${escapeHtml(c.coming60)}</div>` + w60.map((i) => comingItemHtml(i, c, lang)).join("");
    if (w90.length) inner += `<div style="font-size:13px;font-weight:700;color:${INK};margin:14px 0 8px;">${escapeHtml(c.coming90)}</div>` + w90.map((i) => comingItemHtml(i, c, lang)).join("");
    sections.push(sectionShell(c.comingTitle, inner + overflowLine(input.overflow.coming, c)));
  }

  {
    const inner = input.changes.length
      ? input.changes.map((ch) => changeItemHtml(ch, c, lang)).join("") + overflowLine(input.overflow.changes, c)
      : `<div style="background:#ffffff;border:1px solid #e3ddd0;border-radius:12px;padding:16px;font-size:13px;color:${MUTED};line-height:1.55;">${escapeHtml(c.changedFallback)}</div>`;
    sections.push(sectionShell(c.changedTitle, inner));
  }

  if (input.needsFromYou.length) {
    sections.push(
      sectionShell(c.needsTitle, input.needsFromYou.map((n) => needItemHtml(n, c, lang)).join("") + overflowLine(input.overflow.needs, c))
    );
  }

  // Compliance health.
  const healthInner =
    `<div style="background:#ffffff;border:1px solid #e3ddd0;border-radius:12px;padding:20px 16px;text-align:center;">` +
    `<div style="font-size:34px;font-weight:800;color:${TEAL};">${h.percent}%</div>` +
    `<div style="font-size:13px;font-weight:700;color:${INK};margin-top:2px;">${escapeHtml(c.healthCurrent)}</div>` +
    `<div style="font-size:13px;color:${MUTED};margin-top:10px;line-height:1.7;">` +
    `${h.current}/${h.total} · ${c.actionTitle.toLowerCase()}: ${h.upcoming} · ${lang === "es" ? "por verificar" : "needs verification"}: ${h.needsVerification} · ${lang === "es" ? "vencidos críticos" : "critical overdue"}: ${h.overdue}` +
    `</div>` +
    `<div style="margin-top:14px;"><a href="${escapeHtml(input.complianceCenterUrl)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;">${escapeHtml(c.openComplianceCenter)}</a></div>` +
    `</div>`;
  sections.push(sectionShell(c.healthTitle, healthInner));

  const allClearBanner = !hasContent
    ? `<div style="margin:0 0 20px;background:#e6f0ec;border:1px solid #bcd9cd;border-radius:12px;padding:18px 16px;text-align:center;">` +
      `<div style="font-size:17px;font-weight:800;color:${TEAL};">${escapeHtml(c.allClearTitle)}</div>` +
      `<p style="margin:8px 0 0;font-size:14px;color:#2b2b2b;line-height:1.55;">${escapeHtml(c.allClearBody)}</p></div>`
    : "";

  const html =
    `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet"></head>` +
    `<body style="margin:0;background:${PAPER};">` +
    `<div style="max-width:620px;margin:0 auto;padding:28px 10px;font-family:${FONT};color:${INK};">` +
    `<div style="padding:6px 4px 18px;">` +
    `<div style="font-size:12px;font-weight:800;letter-spacing:0.14em;color:${TEAL};">SMARTPR MONTHLY COMPLIANCE DIGEST</div>` +
    `<div style="font-size:22px;font-weight:700;margin-top:6px;">${escapeHtml(input.businessLabel)}</div>` +
    `<div style="font-size:14px;color:${MUTED};margin-top:2px;">${escapeHtml(input.monthLabel)}</div>` +
    `</div>` +
    `<div style="background:#ffffff;border:1px solid #e3ddd0;border-radius:12px;padding:18px;margin:0 0 20px;">` +
    `<p style="margin:0;font-size:15px;line-height:1.65;color:${INK};">${escapeHtml(greeting)}</p>` +
    `<p style="margin:10px 0 0;font-size:15px;line-height:1.65;color:#2b2b2b;">${escapeHtml(summary)}</p>` +
    `</div>` +
    allClearBanner +
    sections.join("") +
    `<div style="text-align:center;padding:6px 12px 10px;">` +
    `<a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;">${escapeHtml(c.openDashboard)}</a>` +
    `</div>` +
    `<p style="margin:10px 0 0;padding:0 16px 18px;color:${MUTED};font-size:12px;line-height:1.6;text-align:center;">${escapeHtml(c.footer)}<br>` +
    `<a href="${escapeHtml(input.manageUrl)}" style="color:${MUTED};">${escapeHtml(c.manageLabel)}</a> · ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${MUTED};">${escapeHtml(c.unsubLabel)}</a></p>` +
    `</div></body></html>`;

  return { subject: `[SmartPR] ${subject}`, text: t.join("\n"), html };
}
