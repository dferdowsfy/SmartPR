/**
 * Compliance-reminder email templates (English + Puerto Rican Spanish).
 *
 * Template architecture (founder-managed via Supabase `email_templates`):
 * code renders the dynamic *section blocks* (this module) and the stored
 * template is the *wrapper* with {{placeholders}}. Templates carry no logic —
 * only substitution. buildReminderEmail() uses the built-in wrapper;
 * buildReminderEmailWithTemplate() accepts a Supabase-loaded wrapper and
 * falls back to built-in when it is null.
 *
 * Pure functions: this module never touches the network so it is trivially
 * unit-testable.
 *
 * Spanish copy is boricua Spanish — direct, warm, "radicar", "patrono",
 * "se te vence" — never neutral/LatAm phrasing.
 */

import {
  substitutePlaceholders,
  type EmailTemplateKey,
  type EmailTemplateVariable,
} from "./email-templates";

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

/** Template key for a reminder send. */
export function reminderTemplateKey(kind: ReminderKind, tier?: ReminderTier): EmailTemplateKey {
  if (kind === "stalled") return "stalled_nudge";
  if (tier === 60) return "reminder_60";
  if (tier === 7) return "reminder_7";
  return "reminder_30";
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

export interface ReminderBlocks {
  html: Record<string, string>;
  text: Record<string, string>;
  subjectVars: Record<string, string>;
}

/** Pure: render every dynamic block of a reminder email. */
export function renderReminderBlocks(input: ReminderEmailInput): ReminderBlocks {
  if (input.kind === "renewal" && !input.dueDate) {
    throw new Error("renderReminderBlocks: dueDate is required for renewal reminders");
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

  const missingLabel = lang === "es" ? "Todavía te falta:" : "Still missing:";
  const showMissing = input.kind === "renewal" && input.tier === 30 && !!missingItems?.length;

  const header =
    `<div style="background:#0f2a43;border-radius:12px 12px 0 0;padding:20px 24px;">` +
    `<div style="color:#fff;font-size:20px;font-weight:700;">SmartPR</div>` +
    `<div style="color:#9fb4c7;font-size:14px;margin-top:2px;">${escapeHtml(copy.headline)}</div></div>`;

  const intro = `<p style="margin:0 0 12px;padding:0 12px;color:#12212f;font-size:14px;line-height:1.5;">${escapeHtml(copy.intro)}</p>`;

  const details =
    `<table role="presentation" style="width:100%;border-collapse:collapse;">` +
    detailRows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 12px;color:#5b6b7b;font-size:13px;width:38%;">${escapeHtml(k)}</td>` +
          `<td style="padding:8px 12px;color:#12212f;font-size:13px;">${escapeHtml(v)}</td></tr>`
      )
      .join("") +
    `</table>`;

  const missingItemsHtml = showMissing
    ? `<div style="padding:4px 12px 12px;"><div style="font-size:13px;font-weight:700;color:#12212f;margin-bottom:6px;">${escapeHtml(missingLabel)}</div>` +
      `<ul style="margin:0;padding-left:20px;color:#5b6b7b;font-size:13px;">${missingItems!
        .map((m) => `<li>${escapeHtml(m)}</li>`)
        .join("")}</ul></div>`
    : "";

  const ctaButton =
    `<div style="padding:12px;"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;">${escapeHtml(copy.cta)}</a></div>`;

  const unsubLabel = lang === "es" ? "Darme de baja" : "Unsubscribe";
  const footer =
    `<p style="margin:8px 0 0;padding:0 12px;color:#8a99a8;font-size:12px;line-height:1.5;">${escapeHtml(copy.footer)} ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#8a99a8;">${escapeHtml(unsubLabel)}</a></p>`;

  return {
    html: {
      header,
      intro,
      details,
      missing_items: missingItemsHtml,
      cta_button: ctaButton,
      footer,
    },
    text: {
      text_header: `SmartPR — ${copy.headline}`,
      text_intro: copy.intro,
      text_details: detailRows.map(([k, v]) => `${k}: ${v}`).join("\n"),
      text_missing: showMissing ? `\n\n${missingLabel}\n${missingItems!.map((m) => `- ${m}`).join("\n")}` : "",
      text_cta: `${copy.cta}: ${input.actionUrl}`,
      text_footer: `${copy.footer}\n${unsubLabel}: ${input.unsubscribeUrl}`,
    },
    subjectVars: { subject_line: copy.subject },
  };
}

export interface ReminderWrapper {
  subject: string;
  html_template: string;
  text_template: string;
}

export const REMINDER_TEMPLATE_VARIABLES: EmailTemplateVariable[] = [
  { name: "subject_line", description: "Subject: localized subject line (urgency + requirement name, or nudge headline)." },
  { name: "header", description: "HTML: navy SmartPR header with the urgency headline." },
  { name: "intro", description: "HTML: intro paragraph explaining what's due and why it matters." },
  { name: "details", description: "HTML: requirement / business / agency / due-date table." },
  { name: "missing_items", description: "HTML: 'still missing' evidence list (30-day tier only; empty otherwise)." },
  { name: "cta_button", description: "HTML: call-to-action button linking back into the app." },
  { name: "footer", description: "HTML: footer with the unsubscribe link." },
  { name: "text_header", description: "Text: 'SmartPR — headline' line." },
  { name: "text_intro", description: "Text: intro paragraph." },
  { name: "text_details", description: "Text: detail lines." },
  { name: "text_missing", description: "Text: missing-evidence list (empty unless 30-day tier with missing items)." },
  { name: "text_cta", description: "Text: CTA label + deep link." },
  { name: "text_footer", description: "Text: footer + unsubscribe link." },
];

/** The built-in wrapper — byte-equivalent to the pre-template reminder layout. Shared across tiers; copy comes from blocks. */
export function builtinReminderWrapper(): ReminderWrapper {
  return {
    subject: "[SmartPR] {{subject_line}}",
    html_template:
      `<!DOCTYPE html><html><body style="margin:0;background:#f2f5f7;">` +
      `<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
      `{{header}}` +
      `<div style="background:#fff;border-radius:0 0 12px 12px;padding:16px 12px;">` +
      `{{intro}}{{details}}{{missing_items}}{{cta_button}}{{footer}}` +
      `</div></div></body></html>`,
    text_template:
      `{{text_header}}\n\n{{text_intro}}\n\n{{text_details}}{{text_missing}}\n\n{{text_cta}}\n\n{{text_footer}}`,
  };
}

/**
 * Build a reminder email from a template wrapper. Pass null to use the
 * built-in wrapper (fallback when the Supabase template is missing or
 * failed to load).
 */
export function buildReminderEmailWithTemplate(
  input: ReminderEmailInput,
  tmpl: ReminderWrapper | null
): BuiltEmail {
  const blocks = renderReminderBlocks(input);
  const w = tmpl ?? builtinReminderWrapper();
  const subject = substitutePlaceholders(w.subject, blocks.subjectVars);
  const html = substitutePlaceholders(w.html_template, blocks.html);
  const text = substitutePlaceholders(w.text_template, blocks.text);
  for (const [name, r] of [["subject", subject], ["html", html], ["text", text]] as const) {
    if (r.unknown.length) console.warn(`[reminder-email] unknown placeholders in ${name}: ${r.unknown.join(", ")}`);
  }
  return { subject: subject.output, text: text.output, html: html.output };
}

/** Legacy entry point — identical output to before, via the built-in wrapper. */
export function buildReminderEmail(input: ReminderEmailInput): BuiltEmail {
  return buildReminderEmailWithTemplate(input, null);
}

/** Tier parsed from a scheduled notification type like "RENEWAL_30_DAY". */
export function tierFromNotificationType(type: string): ReminderTier | null {
  const m = /^RENEWAL_(\d+)_DAY$/.exec(type);
  if (!m) return null;
  const n = Number(m[1]);
  return n === 60 || n === 30 || n === 7 ? (n as ReminderTier) : null;
}
