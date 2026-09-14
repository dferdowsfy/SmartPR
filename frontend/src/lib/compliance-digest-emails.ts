/**
 * Monthly compliance-digest email templates (English + Puerto Rican Spanish).
 *
 * Pure functions: buildDigestEmail() takes the digest facts and returns
 * { subject, text, html }. Sending lives in the cron route; this module never
 * touches the network so it is trivially unit-testable.
 *
 * Spanish copy is boricua Spanish — direct, warm, "radicar", "se te vence",
 * "ir alante" — never neutral/LatAm phrasing.
 *
 * Founder rule enforced by construction: the digest never invents a date.
 * Obligations without a stored expiry appear ONLY in the "missing dates"
 * section, with no fabricated deadline.
 */

export interface DigestDueItem {
  obligationId: string;
  name: string;
  businessName: string;
  businessRef: string;
  agency: string | null;
  /** YYYY-MM-DD, always a stored date with provenance — never invented */
  dueDate: string;
  /** Days from today to dueDate; negative = overdue */
  daysRemaining: number;
  actionUrl: string;
}

export interface DigestStalledItem {
  obligationId: string;
  name: string;
  businessName: string;
  businessRef: string;
  agency: string | null;
  daysStalled: number;
  actionUrl: string;
}

export interface DigestMissingItem {
  obligationId: string;
  name: string;
  businessName: string;
  businessRef: string;
  agency: string | null;
  actionUrl: string;
}

export interface DigestEmailInput {
  lang: "en" | "es";
  /** e.g. "October 2026" / "octubre de 2026" */
  monthLabel: string;
  userName: string | null;
  /** <= 30 days out (overdue first) */
  dueSoon: DigestDueItem[];
  /** 31–90 days out */
  dueLater: DigestDueItem[];
  stalled: DigestStalledItem[];
  /** Renewable obligations with NO stored expiry date — never given a date */
  missingDates: DigestMissingItem[];
  dashboardUrl: string;
  manageUrl: string;
  unsubscribeUrl: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Pure: which digest section does a days-remaining value belong to? */
export function bucketDigestItem(daysRemaining: number): "dueSoon" | "dueLater" | null {
  if (daysRemaining <= 30) return "dueSoon";
  if (daysRemaining <= 90) return "dueLater";
  return null;
}

/** Pure: soonest first (overdue items, most negative, come first). */
export function sortDigestSoonestFirst<T extends { daysRemaining: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.daysRemaining - b.daysRemaining);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatDateLong(iso: string, lang: "en" | "es"): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "es" ? "es-PR" : "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysLabel(days: number, lang: "en" | "es"): string {
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

/** Chip color: red for overdue/urgent, amber for within 30 days, slate for later. */
function chipStyle(days: number): string {
  const base = "display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;";
  if (days <= 7) return `${base}background:#fef2f2;color:#b91c1c;`;
  if (days <= 30) return `${base}background:#fffbeb;color:#b45309;`;
  return `${base}background:#f1f5f9;color:#475569;`;
}

interface SectionCopy {
  title: string;
  intro: string;
}

function sectionCopy(section: "dueSoon" | "dueLater" | "stalled" | "missing", lang: "en" | "es"): SectionCopy {
  if (lang === "es") {
    switch (section) {
      case "dueSoon":
        return { title: "Se vence en los próximos 30 días", intro: "Esto necesita acción ya. Lo más próximo va primero." };
      case "dueLater":
        return { title: "Se vence en 1 a 3 meses", intro: "En el radar — tienes tiempo, pero no lo pierdas de vista." };
      case "stalled":
        return { title: "Necesita tu atención", intro: "Estas radicaciones llevan 14 días o más sin moverse." };
      case "missing":
        return {
          title: "Faltan fechas",
          intro: "Estas renovaciones no tienen fecha de vencimiento guardada, así que no te podemos avisar cuando se acerquen. Agrega la fecha y las incluimos en tu próximo resumen.",
        };
    }
  }
  switch (section) {
    case "dueSoon":
      return { title: "Due within 30 days", intro: "These need action now. Soonest first." };
    case "dueLater":
      return { title: "Due in 1–3 months", intro: "On the radar — you have time, but keep them in sight." };
    case "stalled":
      return { title: "Needs your attention", intro: "These filings haven't moved in 14 days or more." };
    case "missing":
      return {
        title: "Missing dates",
        intro: "These renewals have no expiry date stored, so we can't warn you as they approach. Add the date and we'll include them in your next snapshot.",
      };
  }
}

function itemMetaHtml(item: { businessName: string; agency: string | null }): string {
  const parts = [escapeHtml(item.businessName)];
  if (item.agency) parts.push(escapeHtml(item.agency));
  return `<div style="font-size:12px;color:#8a99a8;margin-top:4px;">${parts.join(" · ")}</div>`;
}

function dueRowHtml(item: DigestDueItem, lang: "en" | "es"): string {
  const cta = lang === "es" ? "Ver requisito" : "View requirement";
  return (
    `<div style="padding:12px 16px;border-bottom:1px solid #eef2f5;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">` +
    `<div style="min-width:0;">` +
    `<a href="${escapeHtml(item.actionUrl)}" style="color:#0f2a43;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(item.name)}</a>` +
    itemMetaHtml(item) +
    `<div style="font-size:12px;color:#5b6b7b;margin-top:4px;">${escapeHtml(formatDateLong(item.dueDate, lang))}</div>` +
    `</div>` +
    `<div style="text-align:right;flex-shrink:0;">` +
    `<span style="${chipStyle(item.daysRemaining)}">${escapeHtml(daysLabel(item.daysRemaining, lang))}</span>` +
    `<div style="margin-top:8px;"><a href="${escapeHtml(item.actionUrl)}" style="font-size:12px;font-weight:700;color:#0f766e;text-decoration:none;">${cta} →</a></div>` +
    `</div></div></div>`
  );
}

function stalledRowHtml(item: DigestStalledItem, lang: "en" | "es"): string {
  const cta = lang === "es" ? "Retomar" : "Resume";
  const days = lang === "es" ? `sin moverse hace ${item.daysStalled} días` : `idle for ${item.daysStalled} days`;
  return (
    `<div style="padding:12px 16px;border-bottom:1px solid #eef2f5;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">` +
    `<div style="min-width:0;">` +
    `<a href="${escapeHtml(item.actionUrl)}" style="color:#0f2a43;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(item.name)}</a>` +
    itemMetaHtml(item) +
    `<div style="font-size:12px;color:#b45309;margin-top:4px;font-weight:600;">${escapeHtml(days)}</div>` +
    `</div>` +
    `<div style="flex-shrink:0;margin-top:2px;"><a href="${escapeHtml(item.actionUrl)}" style="font-size:12px;font-weight:700;color:#0f766e;text-decoration:none;">${cta} →</a></div>` +
    `</div></div>`
  );
}

function missingRowHtml(item: DigestMissingItem, lang: "en" | "es"): string {
  const cta = lang === "es" ? "Agregar fecha" : "Add date";
  return (
    `<div style="padding:12px 16px;border-bottom:1px solid #eef2f5;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">` +
    `<div style="min-width:0;">` +
    `<a href="${escapeHtml(item.actionUrl)}" style="color:#0f2a43;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(item.name)}</a>` +
    itemMetaHtml(item) +
    `</div>` +
    `<div style="flex-shrink:0;margin-top:2px;"><a href="${escapeHtml(item.actionUrl)}" style="font-size:12px;font-weight:700;color:#0f766e;text-decoration:none;">${cta} →</a></div>` +
    `</div></div>`
  );
}

function sectionHtml(title: string, intro: string, rowsHtml: string, accent: string): string {
  return (
    `<div style="background:#fff;border:1px solid #e6edf2;border-radius:12px;margin:0 12px 16px;overflow:hidden;">` +
    `<div style="padding:14px 16px 10px;border-left:4px solid ${accent};">` +
    `<div style="font-size:15px;font-weight:800;color:#0f2a43;">${escapeHtml(title)}</div>` +
    `<div style="font-size:13px;color:#5b6b7b;margin-top:2px;">${escapeHtml(intro)}</div>` +
    `</div>` +
    `${rowsHtml}` +
    `</div>`
  );
}

export function buildDigestEmail(input: DigestEmailInput): BuiltEmail {
  const { lang } = input;
  const dueSoon = sortDigestSoonestFirst(input.dueSoon);
  const dueLater = sortDigestSoonestFirst(input.dueLater);
  const hasFires = dueSoon.length > 0 || input.stalled.length > 0;
  const totalItems = dueSoon.length + dueLater.length + input.stalled.length + input.missingDates.length;

  const greeting = input.userName
    ? lang === "es" ? `Hola ${input.userName},` : `Hi ${input.userName},`
    : lang === "es" ? "Hola," : "Hi,";
  const subject = lang === "es"
    ? `Tu resumen de cumplimiento SmartPR — ${input.monthLabel}`
    : `Your SmartPR compliance snapshot — ${input.monthLabel}`;
  const headline = lang === "es" ? "Tu resumen mensual de cumplimiento" : "Your monthly compliance snapshot";
  const allClearTitle = lang === "es" ? "Todo al día 🎉" : "You're all clear 🎉";
  const allClearBody = lang === "es"
    ? "Nada por vencer en los próximos 90 días y ninguna radicación estancada. Así se ve ir alante."
    : "Nothing due in the next 90 days and no stalled filings. This is what staying ahead looks like.";
  const intro = lang === "es"
    ? "Esto es todo lo que tienes en el radar este mes — lo más próximo primero."
    : "Here's everything on your radar this month — soonest first.";
  const openDashboard = lang === "es" ? "Abrir SmartPR" : "Open SmartPR";
  const footer = lang === "es"
    ? "Recibes el resumen mensual porque tienes los recordatorios activados."
    : "You're getting the monthly digest because reminders are on for your account.";
  const manageLabel = lang === "es" ? "Manejar preferencias" : "Manage preferences";
  const unsubLabel = lang === "es" ? "Darme de baja de todos los avisos" : "Unsubscribe from all reminder emails";

  // ------------------------------------------------------------------ text --
  const t: string[] = [`SmartPR — ${headline}`, "", `${greeting}`, ""];
  if (!hasFires && totalItems === 0) {
    t.push(allClearTitle, "", allClearBody);
  } else {
    if (!hasFires) t.push(allClearTitle, "", allClearBody, "");
    else t.push(intro, "");
    const pushSection = (title: string, lines: string[]) => {
      if (!lines.length) return;
      t.push(title, ...lines.map((l) => `• ${l}`), "");
    };
    pushSection(
      sectionCopy("dueSoon", lang).title,
      dueSoon.map((i) => `${i.name} — ${i.businessName} — ${i.dueDate} (${daysLabel(i.daysRemaining, lang)})`)
    );
    pushSection(
      sectionCopy("dueLater", lang).title,
      dueLater.map((i) => `${i.name} — ${i.businessName} — ${i.dueDate} (${daysLabel(i.daysRemaining, lang)})`)
    );
    pushSection(
      sectionCopy("stalled", lang).title,
      input.stalled.map((i) => `${i.name} — ${i.businessName} (${lang === "es" ? `sin moverse hace ${i.daysStalled} días` : `idle for ${i.daysStalled} days`})`)
    );
    pushSection(
      sectionCopy("missing", lang).title,
      input.missingDates.map((i) => `${i.name} — ${i.businessName}`)
    );
  }
  t.push(`${openDashboard}: ${input.dashboardUrl}`, "", footer, `${manageLabel}: ${input.manageUrl}`, `${unsubLabel}: ${input.unsubscribeUrl}`);

  // ------------------------------------------------------------------- html --
  const heroBanner = !hasFires
    ? `<div style="margin:0 12px 16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:20px 16px;text-align:center;">` +
      `<div style="font-size:18px;font-weight:800;color:#065f46;">${escapeHtml(allClearTitle)}</div>` +
      `<p style="margin:8px 0 0;font-size:14px;color:#047857;line-height:1.5;">${escapeHtml(allClearBody)}</p></div>`
    : `<p style="margin:0 0 16px;padding:0 12px;color:#12212f;font-size:14px;line-height:1.5;">${escapeHtml(greeting)} ${escapeHtml(intro)}</p>`;

  const sections: string[] = [];
  if (dueSoon.length) {
    const c = sectionCopy("dueSoon", lang);
    sections.push(sectionHtml(c.title, c.intro, dueSoon.map((i) => dueRowHtml(i, lang)).join(""), "#dc2626"));
  }
  if (dueLater.length) {
    const c = sectionCopy("dueLater", lang);
    sections.push(sectionHtml(c.title, c.intro, dueLater.map((i) => dueRowHtml(i, lang)).join(""), "#d97706"));
  }
  if (input.stalled.length) {
    const c = sectionCopy("stalled", lang);
    sections.push(sectionHtml(c.title, c.intro, input.stalled.map((i) => stalledRowHtml(i, lang)).join(""), "#7c3aed"));
  }
  if (input.missingDates.length) {
    const c = sectionCopy("missing", lang);
    sections.push(sectionHtml(c.title, c.intro, input.missingDates.map((i) => missingRowHtml(i, lang)).join(""), "#64748b"));
  }

  const html =
    `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;background:#f2f5f7;">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="background:#0f2a43;border-radius:12px 12px 0 0;padding:22px 24px;">` +
    `<div style="color:#fff;font-size:20px;font-weight:700;">SmartPR</div>` +
    `<div style="color:#9fb4c7;font-size:14px;margin-top:4px;">${escapeHtml(headline)} · ${escapeHtml(input.monthLabel)}</div>` +
    `</div>` +
    `<div style="background:#f8fafc;border-radius:0 0 12px 12px;padding:20px 4px 8px;">` +
    heroBanner +
    sections.join("") +
    `<div style="text-align:center;padding:8px 12px 12px;">` +
    `<a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;">${escapeHtml(openDashboard)}</a>` +
    `</div>` +
    `<p style="margin:8px 0 0;padding:0 16px 16px;color:#8a99a8;font-size:12px;line-height:1.6;text-align:center;">${escapeHtml(footer)}<br>` +
    `<a href="${escapeHtml(input.manageUrl)}" style="color:#8a99a8;">${escapeHtml(manageLabel)}</a> · ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#8a99a8;">${escapeHtml(unsubLabel)}</a></p>` +
    `</div></div></body></html>`;

  return { subject: `[SmartPR] ${subject}`, text: t.join("\n"), html };
}
