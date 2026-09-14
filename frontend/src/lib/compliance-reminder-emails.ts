/**
 * Compliance-reminder email templates (English + Puerto Rican Spanish).
 *
 * Pure functions: buildReminderEmail() takes the reminder facts and returns
 * { subject, text, html }. Sending lives in the cron route; this module never
 * touches the network so it is trivially unit-testable.
 *
 * Spanish copy is boricua Spanish — direct, warm, "radicar", "patrono",
 * "se te vence" — never neutral/LatAm phrasing.
 */

export type ReminderTier = 60 | 30 | 7;
export type ReminderKind = "renewal" | "stalled";

export interface ReminderEmailInput {
  kind: ReminderKind;
  tier?: ReminderTier; // required when kind === "renewal"
  lang: "en" | "es";
  obligationName: string;
  businessName: string;
  agency: string | null;
  /** YYYY-MM-DD; required when kind === "renewal" */
  dueDate?: string;
  /** Evidence items still missing (shown on the 30-day reminder) */
  missingItems?: string[];
  /** Deep link back into the app */
  actionUrl: string;
  /** Unsubscribe URL */
  unsubscribeUrl: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
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

interface Copy {
  subject: string;
  headline: string;
  intro: string;
  cta: string;
  footer: string;
}

function copyFor(input: ReminderEmailInput): Copy {
  const { kind, tier, lang, obligationName, businessName, dueDate } = input;
  const due = dueDate ? formatDateLong(dueDate, lang) : "";
  if (kind === "stalled") {
    return lang === "es"
      ? {
          subject: `Retoma tu radicación: ${obligationName}`,
          headline: "Llevas 14 días sin moverte en esto",
          intro: `La radicación de "${obligationName}" para ${businessName} lleva 14 días sin actividad. Retómala ahora y evita que se te acumule con todo lo demás.`,
          cta: "Continuar donde me quedé",
          footer: "Recibes este aviso porque tienes activados los recordatorios de SmartPR.",
        }
      : {
          subject: `Pick up where you left off: ${obligationName}`,
          headline: "This filing has been sitting for 14 days",
          intro: `Your "${obligationName}" filing for ${businessName} hasn't moved in 14 days. Pick it back up now before it piles up with everything else.`,
          cta: "Continue where I left off",
          footer: "You're receiving this because SmartPR reminders are on for your account.",
        };
  }
  const t = tier ?? 30;
  if (lang === "es") {
    const urgency =
      t === 7 ? "¡Se vence esta semana!"
      : t === 30 ? "Se vence en 30 días"
      : "Se vence en 60 días";
    return {
      subject: `${urgency} ${obligationName}`,
      headline: urgency,
      intro:
        t === 7
          ? `"${obligationName}" para ${businessName} se vence el ${due}. Si se te pasa la fecha, puedes enfrentar multas o tener que empezar el proceso de nuevo. Radícalo esta semana.`
          : `"${obligationName}" para ${businessName} se vence el ${due}. Tienes ${t} días para radicar la renovación sin contratiempos.`,
      cta: "Ver qué me falta",
      footer: "Recibes este aviso porque tienes activados los recordatorios de SmartPR.",
    };
  }
  const urgency =
    t === 7 ? "Due this week!"
    : t === 30 ? "Due in 30 days"
    : "Due in 60 days";
  return {
    subject: `${urgency} ${obligationName}`,
    headline: urgency,
    intro:
      t === 7
        ? `"${obligationName}" for ${businessName} is due ${due}. Miss the date and you risk fines or having to restart the process. File it this week.`
        : `"${obligationName}" for ${businessName} is due ${due}. You have ${t} days to file the renewal without a scramble.`,
    cta: "See what's missing",
    footer: "You're receiving this because SmartPR reminders are on for your account.",
  };
}

export function buildReminderEmail(input: ReminderEmailInput): BuiltEmail {
  if (input.kind === "renewal" && !input.dueDate) {
    throw new Error("buildReminderEmail: dueDate is required for renewal reminders");
  }
  const copy = copyFor(input);
  const { lang, obligationName, businessName, agency, missingItems } = input;

  const detailRows: Array<[string, string]> = [
    [lang === "es" ? "Requisito" : "Requirement", obligationName],
    [lang === "es" ? "Negocio" : "Business", businessName],
  ];
  if (agency) detailRows.push([lang === "es" ? "Agencia" : "Agency", agency]);
  if (input.dueDate) {
    detailRows.push([
      lang === "es" ? "Fecha de vencimiento" : "Due date",
      formatDateLong(input.dueDate, lang),
    ]);
  }

  const textLines = [
    `SmartPR — ${copy.headline}`,
    "",
    copy.intro,
    "",
    ...detailRows.map(([k, v]) => `${k}: ${v}`),
  ];
  if (input.kind === "renewal" && input.tier === 30 && missingItems?.length) {
    textLines.push("", lang === "es" ? "Todavía te falta:" : "Still missing:");
    for (const item of missingItems) textLines.push(`- ${item}`);
  }
  textLines.push("", `${copy.cta}: ${input.actionUrl}`, "", copy.footer, `${lang === "es" ? "Darme de baja" : "Unsubscribe"}: ${input.unsubscribeUrl}`);

  const rowsHtml = detailRows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px;color:#5b6b7b;font-size:13px;width:38%;">${escapeHtml(k)}</td>` +
        `<td style="padding:8px 12px;color:#12212f;font-size:13px;">${escapeHtml(v)}</td></tr>`
    )
    .join("");
  const missingHtml =
    input.kind === "renewal" && input.tier === 30 && missingItems?.length
      ? `<div style="padding:4px 12px 12px;"><div style="font-size:13px;font-weight:700;color:#12212f;margin-bottom:6px;">${
          lang === "es" ? "Todavía te falta:" : "Still missing:"
        }</div><ul style="margin:0;padding-left:20px;color:#5b6b7b;font-size:13px;">${missingItems
          .map((m) => `<li>${escapeHtml(m)}</li>`)
          .join("")}</ul></div>`
      : "";
  const html =
    `<!DOCTYPE html><html><body style="margin:0;background:#f2f5f7;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="background:#0f2a43;border-radius:12px 12px 0 0;padding:20px 24px;">` +
    `<div style="color:#fff;font-size:20px;font-weight:700;">SmartPR</div>` +
    `<div style="color:#9fb4c7;font-size:14px;margin-top:2px;">${escapeHtml(copy.headline)}</div></div>` +
    `<div style="background:#fff;border-radius:0 0 12px 12px;padding:16px 12px;">` +
    `<p style="margin:0 0 12px;padding:0 12px;color:#12212f;font-size:14px;line-height:1.5;">${escapeHtml(copy.intro)}</p>` +
    `<table role="presentation" style="width:100%;border-collapse:collapse;">${rowsHtml}</table>` +
    missingHtml +
    `<div style="padding:12px;"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;">${escapeHtml(copy.cta)}</a></div>` +
    `<p style="margin:8px 0 0;padding:0 12px;color:#8a99a8;font-size:12px;line-height:1.5;">${escapeHtml(copy.footer)} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#8a99a8;">${lang === "es" ? "Darme de baja" : "Unsubscribe"}</a></p>` +
    `</div></div></body></html>`;

  return { subject: `[SmartPR] ${copy.subject}`, text: textLines.join("\n"), html };
}

/** Tier parsed from a scheduled notification type like "RENEWAL_30_DAY". */
export function tierFromNotificationType(type: string): ReminderTier | null {
  const m = /^RENEWAL_(\d+)_DAY$/.exec(type);
  if (!m) return null;
  const n = Number(m[1]);
  return n === 60 || n === 30 || n === 7 ? (n as ReminderTier) : null;
}
