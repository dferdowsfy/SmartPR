/**
 * Supabase-managed email templates for SmartPR compliance emails.
 *
 * The founder manages these like Supabase Auth emails (Dashboard →
 * Authentication → Emails): the `email_templates` table holds the *wrapper*
 * (subject + HTML + text) with {{placeholders}}, while code renders the
 * dynamic section blocks (executive summary, action items, …) and
 * substitutes them in. Templates carry no logic — only substitution.
 *
 * Safety rules:
 * - A missing/failing DB template NEVER drops a send: the cron falls back
 *   to the built-in wrapper and still sends.
 * - Unknown placeholders render as empty (and warn) — they can never break
 *   a send or leak raw {{tokens}} into a delivered email.
 * - Every send is archived to `email_archive` with its full rendered body.
 */

export type EmailTemplateKey =
  | "digest"
  | "reminder_60"
  | "reminder_30"
  | "reminder_7"
  | "stalled_nudge";

export type EmailTemplateLang = "en" | "es";

export interface EmailTemplateVariable {
  name: string;
  description: string;
}

export interface EmailTemplateDef {
  key: EmailTemplateKey;
  lang: EmailTemplateLang;
  subject: string;
  html_template: string;
  text_template: string;
  variables: EmailTemplateVariable[];
}

/** A template row as loaded from Supabase (or null when unavailable). */
export interface DbEmailTemplate {
  key: string;
  lang: string;
  subject: string;
  html_template: string;
  text_template: string;
  variables: EmailTemplateVariable[];
  updated_at: string | null;
  updated_by: string | null;
}

/** Minimal DB surface — pg Pool/PoolClient both satisfy this. */
export interface TemplateDb {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Pure: substitute {{placeholders}} with pre-rendered values.
 * Unknown placeholders become "" (never leak into a sent email).
 */
export function substitutePlaceholders(
  template: string,
  values: Record<string, string>
): { output: string; unknown: string[] } {
  const unknown = new Set<string>();
  const output = template.replace(PLACEHOLDER_RE, (m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
    unknown.add(name);
    return "";
  });
  return { output, unknown: [...unknown] };
}

export interface TemplateValidation {
  /** Placeholders in the template that code never provides. */
  unknown: string[];
  /** Documented variables absent from the template (advisory). */
  missing: string[];
  /** Literal "{{" without a closing "}}" — likely a typo. */
  unclosed: boolean;
}

/** Pure: validate a template against its documented variables. Advisory only — never blocks a send. */
export function validateTemplate(
  template: { subject: string; html_template: string; text_template: string },
  variables: EmailTemplateVariable[]
): TemplateValidation {
  const combined = `${template.subject}\n${template.html_template}\n${template.text_template}`;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE);
  while ((m = re.exec(combined)) !== null) found.add(m[1]);
  const known = new Set(variables.map((v) => v.name));
  const withoutPlaceholders = combined.replace(re, "");
  return {
    unknown: [...found].filter((n) => !known.has(n)),
    missing: [...known].filter((n) => !found.has(n)),
    unclosed: /\{\{/.test(withoutPlaceholders),
  };
}

function rowToTemplate(r: Record<string, unknown>): DbEmailTemplate {
  const vars = r.variables;
  return {
    key: String(r.key),
    lang: String(r.lang),
    subject: String(r.subject ?? ""),
    html_template: String(r.html_template ?? ""),
    text_template: String(r.text_template ?? ""),
    variables: Array.isArray(vars)
      ? (vars as { name?: unknown; description?: unknown }[])
          .filter((v) => typeof v?.name === "string")
          .map((v) => ({
            name: String(v.name),
            description: typeof v.description === "string" ? v.description : "",
          }))
      : [],
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
    updated_by: typeof r.updated_by === "string" ? r.updated_by : null,
  };
}

/**
 * Load one template from Supabase. Returns null when the table is missing,
 * the row is absent, or anything fails — callers fall back to the built-in
 * wrapper and still send.
 */
export async function loadEmailTemplate(
  db: TemplateDb,
  key: string,
  lang: string
): Promise<DbEmailTemplate | null> {
  try {
    const { rows } = await db.query(
      `SELECT key, lang, subject, html_template, text_template, variables,
              updated_at::text AS updated_at, updated_by
         FROM email_templates
        WHERE key = $1 AND lang = $2
        LIMIT 1`,
      [key, lang]
    );
    if (!rows[0]) return null;
    const t = rowToTemplate(rows[0]);
    if (!t.subject && !t.html_template && !t.text_template) return null;
    return t;
  } catch (err) {
    console.warn(
      `[email-templates] load failed for ${key}/${lang}, using built-in:`,
      (err as Error)?.message || err
    );
    return null;
  }
}

/** Per-cron-run memoized template loader (one DB hit per key+lang, then cached). */
export function createTemplateCache(db: TemplateDb): {
  get(key: string, lang: string): Promise<DbEmailTemplate | null>;
} {
  const cache = new Map<string, Promise<DbEmailTemplate | null>>();
  return {
    get(key: string, lang: string) {
      const k = `${key}:${lang}`;
      let p = cache.get(k);
      if (!p) {
        p = loadEmailTemplate(db, key, lang);
        cache.set(k, p);
      }
      return p;
    },
  };
}
export type TemplateCache = ReturnType<typeof createTemplateCache>;

/**
 * Idempotent seed of the built-in wrappers. ON CONFLICT DO NOTHING so an
 * admin's edits are never overwritten by a later deploy or cron run.
 */
export async function ensureEmailTemplatesSeeded(
  db: TemplateDb,
  defs: EmailTemplateDef[]
): Promise<void> {
  try {
    for (const d of defs) {
      await db.query(
        `INSERT INTO email_templates
           (key, lang, subject, html_template, text_template, variables, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'seed')
         ON CONFLICT (key, lang) DO NOTHING`,
        [d.key, d.lang, d.subject, d.html_template, d.text_template, JSON.stringify(d.variables)]
      );
    }
  } catch (err) {
    // Table not yet migrated — the built-in wrappers still work.
    console.warn("[email-templates] seed skipped:", (err as Error)?.message || err);
  }
}

export interface ArchivedEmail {
  templateKey: string;
  lang: string;
  /** 'db' when the Supabase template rendered the send, 'builtin' on fallback. */
  templateSource: "db" | "builtin";
  /** The template row's updated_at at send time — which version rendered it. */
  templateUpdatedAt: string | null;
  recipientUserId: string | null;
  workspaceId: string | null;
  recipientEmail: string | null;
  subject: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Archive a sent email's full rendered body for support/audit
 * ("show me exactly what we sent"). Never throws — archiving must not
 * break sending.
 */
export async function archiveEmail(db: TemplateDb, entry: ArchivedEmail): Promise<void> {
  try {
    await db.query(
      `INSERT INTO email_archive
         (template_key, lang, template_source, template_updated_at,
          recipient_user_id, workspace_id,
          recipient_email, subject, html_body, text_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.templateKey,
        entry.lang,
        entry.templateSource,
        entry.templateUpdatedAt,
        entry.recipientUserId,
        entry.workspaceId,
        entry.recipientEmail,
        entry.subject,
        entry.htmlBody,
        entry.textBody,
      ]
    );
  } catch (err) {
    console.warn("[email-templates] archive failed:", (err as Error)?.message || err);
  }
}
