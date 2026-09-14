/**
 * Supabase-managed compliance email templates: loading, fallback,
 * placeholder substitution, idempotent seeding, and archive writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  archiveEmail,
  createTemplateCache,
  ensureEmailTemplatesSeeded,
  loadEmailTemplate,
  substitutePlaceholders,
  validateTemplate,
  type EmailTemplateDef,
  type TemplateDb,
} from "../email-templates";
import { allEmailTemplateDefs } from "../email-template-seeds";
import {
  buildDigestEmailWithTemplate,
  builtinDigestWrapper,
  renderDigestBlocks,
} from "../compliance-digest-emails";
import {
  buildReminderEmailWithTemplate,
  builtinReminderWrapper,
  renderReminderBlocks,
} from "../compliance-reminder-emails";
import { sampleDigestInput, sampleReminderInput } from "../email-preview-samples";

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

function fakeDb(
  rows: Record<string, unknown>[] = [],
  opts: { throwOn?: RegExp } = {}
): TemplateDb & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query(sql: string) {
      queries.push(sql);
      if (opts.throwOn?.test(sql)) throw new Error("relation does not exist");
      return { rows, rowCount: rows.length };
    },
  };
}

// ---------------------------------------------------------------------------
// substitutePlaceholders
// ---------------------------------------------------------------------------

test("substitutePlaceholders replaces known tokens and empties unknown ones", () => {
  const r = substitutePlaceholders("Hello {{name}}, {{bogus}}!", { name: "Darius" });
  assert.equal(r.output, "Hello Darius, !");
  assert.deepEqual(r.unknown, ["bogus"]);
});

test("substitutePlaceholders tolerates whitespace inside tokens", () => {
  const r = substitutePlaceholders("[{{ subject_line }}]", { subject_line: "Hi" });
  assert.equal(r.output, "[Hi]");
  assert.deepEqual(r.unknown, []);
});

// ---------------------------------------------------------------------------
// validateTemplate
// ---------------------------------------------------------------------------

test("validateTemplate flags unknown placeholders and unclosed braces", () => {
  const v = validateTemplate(
    { subject: "[SmartPR] {{subject_line}} {{oops}}", html_template: "{{header}} {{", text_template: "{{text_header}}" },
    [{ name: "subject_line", description: "" }, { name: "header", description: "" }, { name: "text_header", description: "" }]
  );
  assert.deepEqual(v.unknown, ["oops"]);
  assert.equal(v.unclosed, true);
  assert.deepEqual(v.missing, []);
});

test("validateTemplate reports documented variables missing from the template", () => {
  const v = validateTemplate(
    { subject: "Hi", html_template: "{{header}}", text_template: "" },
    [{ name: "header", description: "" }, { name: "footer", description: "" }]
  );
  assert.deepEqual(v.missing, ["footer"]);
});

test("built-in wrappers validate clean against their documented variables", () => {
  const defs = allEmailTemplateDefs();
  for (const d of defs) {
    const v = validateTemplate(
      { subject: d.subject, html_template: d.html_template, text_template: d.text_template },
      d.variables
    );
    assert.deepEqual(v.unknown, [], `${d.key}/${d.lang}: unknown placeholders`);
    assert.equal(v.unclosed, false, `${d.key}/${d.lang}: unclosed braces`);
  }
});

// ---------------------------------------------------------------------------
// loadEmailTemplate / cache
// ---------------------------------------------------------------------------

test("loadEmailTemplate returns the row when present", async () => {
  const db = fakeDb([
    {
      key: "digest", lang: "en", subject: "S", html_template: "H", text_template: "T",
      variables: [{ name: "header", description: "d" }],
      updated_at: "2026-09-14T00:00:00Z", updated_by: "admin@x.com",
    },
  ]);
  const t = await loadEmailTemplate(db, "digest", "en");
  assert.ok(t);
  assert.equal(t.subject, "S");
  assert.equal(t.updated_at, "2026-09-14T00:00:00Z");
  assert.equal(t.updated_by, "admin@x.com");
  assert.deepEqual(t.variables, [{ name: "header", description: "d" }]);
});

test("loadEmailTemplate returns null when the row is missing or the table is gone", async () => {
  assert.equal(await loadEmailTemplate(fakeDb([]), "digest", "en"), null);
  assert.equal(await loadEmailTemplate(fakeDb([], { throwOn: /email_templates/ }), "digest", "en"), null);
});

test("createTemplateCache hits the DB once per key+lang per run", async () => {
  const db = fakeDb([{ key: "digest", lang: "en", subject: "S", html_template: "H", text_template: "T", variables: [] }]);
  const cache = createTemplateCache(db);
  const [a, b] = await Promise.all([cache.get("digest", "en"), cache.get("digest", "en")]);
  assert.equal(a, b);
  assert.equal(db.queries.length, 1);
  await cache.get("digest", "es");
  assert.equal(db.queries.length, 2);
});

// ---------------------------------------------------------------------------
// ensureEmailTemplatesSeeded
// ---------------------------------------------------------------------------

test("allEmailTemplateDefs covers every key in both languages", () => {
  const defs = allEmailTemplateDefs();
  assert.equal(defs.length, 10);
  const keys = new Set(defs.map((d) => `${d.key}:${d.lang}`));
  for (const k of ["digest", "reminder_60", "reminder_30", "reminder_7", "stalled_nudge"]) {
    assert.ok(keys.has(`${k}:en`), k);
    assert.ok(keys.has(`${k}:es`), k);
  }
});

test("seeded wrappers match the built-in wrappers byte-for-byte", () => {
  const defs = allEmailTemplateDefs();
  const reminderBuiltin = builtinReminderWrapper();
  for (const d of defs) {
    const b = d.key === "digest" ? builtinDigestWrapper(d.lang) : reminderBuiltin;
    assert.equal(d.subject, b.subject, `${d.key}/${d.lang} subject`);
    assert.equal(d.html_template, b.html_template, `${d.key}/${d.lang} html`);
    assert.equal(d.text_template, b.text_template, `${d.key}/${d.lang} text`);
  }
});

test("ensureEmailTemplatesSeeded is idempotent and never overwrites", async () => {
  const db = fakeDb();
  const defs: EmailTemplateDef[] = [
    { key: "digest", lang: "en", subject: "S", html_template: "H", text_template: "T", variables: [] },
  ];
  await ensureEmailTemplatesSeeded(db, defs);
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0], /ON CONFLICT \(key, lang\) DO NOTHING/);
});

test("ensureEmailTemplatesSeeded never throws when the table is missing", async () => {
  const db = fakeDb([], { throwOn: /email_templates/ });
  await ensureEmailTemplatesSeeded(db, allEmailTemplateDefs());
});

// ---------------------------------------------------------------------------
// archiveEmail
// ---------------------------------------------------------------------------

test("archiveEmail writes the full rendered body and never throws", async () => {
  const db = fakeDb();
  await archiveEmail(db, {
    templateKey: "digest",
    lang: "en",
    templateSource: "db",
    templateUpdatedAt: "2026-09-14T00:00:00Z",
    recipientUserId: "u1",
    workspaceId: "w1",
    recipientEmail: "a@b.com",
    subject: "S",
    htmlBody: "<p>H</p>",
    textBody: "T",
  });
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0], /INSERT INTO email_archive/);

  const failing = fakeDb([], { throwOn: /email_archive/ });
  await archiveEmail(failing, {
    templateKey: "digest", lang: "en", templateSource: "builtin", templateUpdatedAt: null,
    recipientUserId: null, workspaceId: null, recipientEmail: null,
    subject: "S", htmlBody: "H", textBody: "T",
  });
});

// ---------------------------------------------------------------------------
// buildDigestEmailWithTemplate / buildReminderEmailWithTemplate
// ---------------------------------------------------------------------------

test("digest: a stored wrapper renders sample blocks into its placeholders", () => {
  const input = sampleDigestInput("en");
  const blocks = renderDigestBlocks(input);
  const built = buildDigestEmailWithTemplate(input, {
    subject: "CUSTOM {{subject_line}}",
    html_template: "<div>{{header}}{{action_required}}{{footer}}</div>",
    text_template: "{{text_header}} | {{text_action_required}}",
  });
  assert.ok(built.subject.startsWith("CUSTOM "));
  assert.ok(built.html.includes(blocks.html.header));
  assert.ok(built.html.includes(blocks.html.action_required));
  assert.ok(!built.html.includes("{{"));
});

test("digest: null template falls back to the built-in wrapper", () => {
  const input = sampleDigestInput("es");
  const a = buildDigestEmailWithTemplate(input, null);
  const builtin = builtinDigestWrapper("es");
  const b = buildDigestEmailWithTemplate(input, {
    subject: builtin.subject,
    html_template: builtin.html_template,
    text_template: builtin.text_template,
  });
  assert.equal(a.subject, b.subject);
  assert.equal(a.html, b.html);
  assert.equal(a.text, b.text);
  // The Spanish wrapper carries the localized subject prefix.
  assert.match(a.subject, /tu resumen de cumplimiento/);
});

test("reminder: stored wrapper per tier renders; null falls back to built-in", () => {
  for (const key of ["reminder_60", "reminder_30", "reminder_7", "stalled_nudge"] as const) {
    const input = sampleReminderInput(key, "es");
    const blocks = renderReminderBlocks(input);
    const custom = buildReminderEmailWithTemplate(input, {
      subject: "[X] {{subject_line}}",
      html_template: "{{header}}{{details}}{{missing_items}}",
      text_template: "{{text_header}}\n{{text_details}}{{text_missing}}",
    });
    assert.ok(custom.html.includes(blocks.html.details), key);
    assert.ok(!custom.html.includes("{{"), key);
    const fallback = buildReminderEmailWithTemplate(input, null);
    const builtin = builtinReminderWrapper();
    assert.equal(
      fallback.subject,
      substitutePlaceholders(builtin.subject, blocks.subjectVars).output,
      key
    );
  }
});

test("reminder blocks preserve the no-date rule: renewal without dueDate throws", () => {
  assert.throws(
    () =>
      renderReminderBlocks({
        kind: "renewal",
        tier: 30,
        lang: "en",
        obligationName: "X",
        businessName: "Y",
        agency: null,
        actionUrl: "https://x",
        unsubscribeUrl: "https://x",
      }),
    /dueDate is required/
  );
});
