/**
 * Seed definitions for every Supabase-managed compliance email template.
 *
 * One row per (key, lang): digest + 4 reminder keys x English and
 * Puerto Rican Spanish. The wrappers are identical across languages —
 * localization lives in the code-rendered blocks — but separate rows let
 * the founder edit each language's wrapper independently later.
 *
 * Seeding is idempotent (ON CONFLICT DO NOTHING): it never overwrites an
 * admin's edits.
 */

import {
  builtinDigestWrapper,
  DIGEST_TEMPLATE_VARIABLES,
} from "./compliance-digest-emails";
import {
  builtinReminderWrapper,
  REMINDER_TEMPLATE_VARIABLES,
} from "./compliance-reminder-emails";
import type { EmailTemplateDef, EmailTemplateKey } from "./email-templates";

const LANGS = ["en", "es"] as const;

const REMINDER_KEYS: EmailTemplateKey[] = [
  "reminder_60",
  "reminder_30",
  "reminder_7",
  "stalled_nudge",
];

export function allEmailTemplateDefs(): EmailTemplateDef[] {
  const reminderWrapper = builtinReminderWrapper();
  const defs: EmailTemplateDef[] = [];
  for (const lang of LANGS) {
    const digestWrapper = builtinDigestWrapper(lang);
    defs.push({
      key: "digest",
      lang,
      subject: digestWrapper.subject,
      html_template: digestWrapper.html_template,
      text_template: digestWrapper.text_template,
      variables: DIGEST_TEMPLATE_VARIABLES,
    });
    for (const key of REMINDER_KEYS) {
      defs.push({
        key,
        lang,
        subject: reminderWrapper.subject,
        html_template: reminderWrapper.html_template,
        text_template: reminderWrapper.text_template,
        variables: REMINDER_TEMPLATE_VARIABLES,
      });
    }
  }
  return defs;
}
