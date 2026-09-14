/**
 * Admin API: list and save Supabase-managed compliance email templates.
 * GET  /api/admin/emails          → all template rows (seeded first)
 * POST /api/admin/emails          → save one template's wrapper
 *
 * Super-admin only. Saving never breaks sends: the send path validates
 * nothing at runtime and falls back to the built-in wrapper whenever the
 * stored template is missing or fails to load.
 */
import { getPool, isEnabled } from "../../../graph/db";
import { isCurrentUserSuperAdmin } from "../../../../lib/admin";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { allEmailTemplateDefs } from "../../../../lib/email-template-seeds";
import {
  ensureEmailTemplatesSeeded,
  validateTemplate,
  type EmailTemplateKey,
} from "../../../../lib/email-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_KEYS: EmailTemplateKey[] = [
  "digest",
  "reminder_60",
  "reminder_30",
  "reminder_7",
  "stalled_nudge",
];

const KEY_LABELS: Record<EmailTemplateKey, string> = {
  digest: "Monthly compliance digest",
  reminder_60: "Renewal reminder — 60 days",
  reminder_30: "Renewal reminder — 30 days",
  reminder_7: "Renewal reminder — 7 days",
  stalled_nudge: "Stalled-filing nudge",
};

export async function GET() {
  if (!(await isCurrentUserSuperAdmin())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled()) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  await ensureEmailTemplatesSeeded(pool, allEmailTemplateDefs());
  const { rows } = await pool.query(
    `SELECT key, lang, subject, html_template, text_template, variables,
            updated_at::text AS updated_at, updated_by
       FROM email_templates
      ORDER BY key, lang`
  );
  return Response.json({
    templates: rows.map((r) => ({
      key: r.key,
      lang: r.lang,
      label: KEY_LABELS[r.key as EmailTemplateKey] ?? r.key,
      subject: r.subject,
      html_template: r.html_template,
      text_template: r.text_template,
      variables: r.variables ?? [],
      updated_at: r.updated_at,
      updated_by: r.updated_by,
    })),
  });
}

type SaveBody = {
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

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const key = (body.key ?? "").trim();
  const lang = (body.lang ?? "").trim();
  if (!KNOWN_KEYS.includes(key as EmailTemplateKey) || (lang !== "en" && lang !== "es")) {
    return Response.json({ error: "invalid_input", message: "Unknown template key or lang." }, { status: 400 });
  }
  const subject = body.subject ?? "";
  const html_template = body.html_template ?? "";
  const text_template = body.text_template ?? "";
  if (!subject.trim() || !html_template.trim() || !text_template.trim()) {
    return Response.json(
      { error: "invalid_input", message: "Subject, HTML, and text are all required." },
      { status: 400 }
    );
  }

  const user = await getCurrentUser();
  const updatedBy = user?.email ?? "admin";
  const { rowCount } = await pool.query(
    `UPDATE email_templates
        SET subject = $3, html_template = $4, text_template = $5,
            updated_at = now(), updated_by = $6
      WHERE key = $1 AND lang = $2`,
    [key, lang, subject, html_template, text_template, updatedBy]
  );
  if (!rowCount) {
    return Response.json({ error: "not_found", message: "Template row not found." }, { status: 404 });
  }

  // Advisory validation: warn about typos, never block the save — a
  // malformed edit falls back to the built-in wrapper at send time.
  const def = allEmailTemplateDefs().find((d) => d.key === key && d.lang === lang);
  const validation = def
    ? validateTemplate({ subject, html_template, text_template }, def.variables)
    : null;

  return Response.json({ ok: true, warnings: validation });
}
