/**
 * Admin API: live preview of a compliance email template.
 * POST /api/admin/emails/preview
 *   { key, lang, subject?, html_template?, text_template? }
 * Renders the (possibly unsaved) wrapper against realistic sample blocks —
 * exactly what a real send would produce. Super-admin only.
 */
import { getPool, isEnabled } from "../../../../graph/db";
import { isCurrentUserSuperAdmin } from "../../../../../lib/admin";
import { allEmailTemplateDefs } from "../../../../../lib/email-template-seeds";
import {
  buildDigestEmailWithTemplate,
  renderDigestBlocks,
} from "../../../../../lib/compliance-digest-emails";
import {
  buildReminderEmailWithTemplate,
  renderReminderBlocks,
} from "../../../../../lib/compliance-reminder-emails";
import { substitutePlaceholders, validateTemplate, type EmailTemplateKey } from "../../../../../lib/email-templates";
import {
  sampleDigestInput,
  sampleReminderInput,
} from "../../../../../lib/email-preview-samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewBody = {
  key?: string;
  lang?: string;
  subject?: string;
  html_template?: string;
  text_template?: string;
};

export async function POST(request: Request) {
  if (!(await isCurrentUserSuperAdmin())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled()) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const key = (body.key ?? "").trim();
  const lang = (body.lang ?? "").trim();
  const known = ["digest", "reminder_60", "reminder_30", "reminder_7", "stalled_nudge"];
  if (!known.includes(key) || (lang !== "en" && lang !== "es")) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  // Draft wins (live preview of unsaved edits); otherwise the stored row.
  let wrapper = {
    subject: body.subject ?? "",
    html_template: body.html_template ?? "",
    text_template: body.text_template ?? "",
  };
  let template_source: "draft" | "db" | "builtin" = "draft";
  if (!wrapper.subject && !wrapper.html_template && !wrapper.text_template) {
    const { rows } = await pool.query(
      `SELECT subject, html_template, text_template
         FROM email_templates WHERE key = $1 AND lang = $2 LIMIT 1`,
      [key, lang]
    );
    if (rows[0]) {
      wrapper = {
        subject: String(rows[0].subject ?? ""),
        html_template: String(rows[0].html_template ?? ""),
        text_template: String(rows[0].text_template ?? ""),
      };
      template_source = "db";
    } else {
      template_source = "builtin";
    }
  }

  let built: { subject: string; text: string; html: string };
  if (key === "digest") {
    const input = sampleDigestInput(lang);
    const blocks = renderDigestBlocks(input);
    built =
      template_source === "builtin"
        ? buildDigestEmailWithTemplate(input, null)
        : {
            subject: substitutePlaceholders(wrapper.subject, blocks.subjectVars).output,
            html: substitutePlaceholders(wrapper.html_template, blocks.html).output,
            text: substitutePlaceholders(wrapper.text_template, blocks.text).output,
          };
  } else {
    const input = sampleReminderInput(key as EmailTemplateKey, lang);
    const blocks = renderReminderBlocks(input);
    built =
      template_source === "builtin"
        ? buildReminderEmailWithTemplate(input, null)
        : {
            subject: substitutePlaceholders(wrapper.subject, blocks.subjectVars).output,
            html: substitutePlaceholders(wrapper.html_template, blocks.html).output,
            text: substitutePlaceholders(wrapper.text_template, blocks.text).output,
          };
  }

  const def = allEmailTemplateDefs().find((d) => d.key === key && d.lang === lang);
  const warnings = def
    ? validateTemplate(
        { subject: wrapper.subject, html_template: wrapper.html_template, text_template: wrapper.text_template },
        def.variables
      )
    : null;

  return Response.json({ ...built, warnings, template_source });
}
