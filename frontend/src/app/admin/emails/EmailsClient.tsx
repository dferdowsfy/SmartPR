"use client";

// ============================================================================
// Admin: compliance email template editor.
//
// Lists the Supabase-managed wrappers (one per email x language), edits
// subject / HTML / text, shows the documented {{placeholders}}, renders a
// live preview against realistic sample data, and saves. Validation is
// advisory: unknown placeholders warn but never block a save — a malformed
// edit falls back to the built-in wrapper at send time.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface TemplateVar {
  name: string;
  description: string;
}

interface TemplateRow {
  key: string;
  lang: string;
  label: string;
  subject: string;
  html_template: string;
  text_template: string;
  variables: TemplateVar[];
  updated_at: string | null;
  updated_by: string | null;
}

interface PreviewResult {
  subject: string;
  html: string;
  text: string;
  warnings: { unknown: string[]; missing: string[]; unclosed: boolean } | null;
  template_source: string;
}

const LANG_LABEL: Record<string, string> = { en: "English", es: "Español (PR)" };

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function EmailsClient() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [selLang, setSelLang] = useState<string>("en");

  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewTab, setPreviewTab] = useState<"html" | "text">("html");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/emails");
      if (!res.ok) throw new Error(res.status === 403 ? "Not authorized." : `Load failed (${res.status}).`);
      const data = (await res.json()) as { templates: TemplateRow[] };
      setTemplates(data.templates);
      if (!selKey && data.templates.length) {
        setSelKey(data.templates[0].key);
        setSelLang(data.templates[0].lang);
      }
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [selKey]);

  useEffect(() => {
    load();
  }, [load]);

  const selected: TemplateRow | undefined = useMemo(
    () => templates?.find((t) => t.key === selKey && t.lang === selLang),
    [templates, selKey, selLang]
  );

  // Load the selected template into the editors.
  useEffect(() => {
    if (selected) {
      setSubject(selected.subject);
      setHtml(selected.html_template);
      setText(selected.text_template);
      setDirty(false);
      setSaveMsg(null);
      setPreview(null);
    }
  }, [selected?.key, selected?.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshPreview = useCallback(
    async (s: string, h: string, t: string) => {
      if (!selKey) return;
      try {
        const res = await fetch("/api/admin/emails/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: selKey, lang: selLang, subject: s, html_template: h, text_template: t }),
        });
        if (res.ok) setPreview((await res.json()) as PreviewResult);
      } catch {
        // Preview is best-effort; the editors keep working.
      }
    },
    [selKey, selLang]
  );

  // Debounced live preview of the unsaved draft.
  useEffect(() => {
    if (!selected) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => refreshPreview(subject, html, text), 600);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [subject, html, text, selected, refreshPreview]);

  const save = useCallback(async () => {
    if (!selKey || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/emails", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: selKey, lang: selLang, subject, html_template: html, text_template: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `Save failed (${res.status}).`);
      const w = data.warnings;
      const warnBits: string[] = [];
      if (w?.unknown?.length) warnBits.push(`unknown placeholders: ${w.unknown.join(", ")}`);
      if (w?.unclosed) warnBits.push("unclosed {{ detected");
      setSaveMsg(warnBits.length ? `Saved with warnings — ${warnBits.join("; ")}` : "Saved.");
      setDirty(false);
      await load();
    } catch (err) {
      setSaveMsg(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [selKey, selLang, subject, html, text, saving, load]);

  const markDirty = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setDirty(true);
    setSaveMsg(null);
  };

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-900/20 bg-red-50 p-6 text-sm text-red-900">
        {loadError} <button onClick={load} className="ml-2 underline">Retry</button>
      </div>
    );
  }
  if (!templates) {
    return <div className="py-12 text-center text-sm text-[#5a5a5a]">Loading templates…</div>;
  }

  const grouped = new Map<string, TemplateRow[]>();
  for (const t of templates) {
    const g = grouped.get(t.key) ?? [];
    g.push(t);
    grouped.set(t.key, g);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Template list */}
      <nav className="space-y-4">
        {[...grouped.entries()].map(([key, rows]) => (
          <div key={key} className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-3">
            <div className="px-1 pb-2 text-sm font-semibold">{rows[0].label}</div>
            {rows.map((r) => (
              <button
                key={r.lang}
                onClick={() => {
                  setSelKey(r.key);
                  setSelLang(r.lang);
                }}
                className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  selKey === r.key && selLang === r.lang
                    ? "bg-[#161616] text-[#f6f3ea]"
                    : "hover:bg-[#161616]/5"
                }`}
              >
                <div className="font-medium">{LANG_LABEL[r.lang] ?? r.lang}</div>
                <div className={`truncate text-xs ${selKey === r.key && selLang === r.lang ? "text-[#f6f3ea]/70" : "text-[#5a5a5a]"}`}>
                  {fmtDate(r.updated_at)}{r.updated_by ? ` · ${r.updated_by}` : ""}
                </div>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Editor */}
      {selected && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {selected.label} · {LANG_LABEL[selected.lang]}
              </h2>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-lg bg-[#245c5c] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save template"}
              </button>
            </div>
            {saveMsg && (
              <div
                className={`mb-4 rounded-lg px-3 py-2 text-sm ${
                  saveMsg.startsWith("Saved") ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"
                }`}
              >
                {saveMsg}
              </div>
            )}
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5a5a5a]">
              Subject
            </label>
            <input
              value={subject}
              onChange={(e) => markDirty(setSubject)(e.target.value)}
              className="mb-4 w-full rounded-lg border border-[#161616]/20 bg-white px-3 py-2 font-mono text-sm"
            />
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5a5a5a]">
              HTML wrapper
            </label>
            <textarea
              value={html}
              onChange={(e) => markDirty(setHtml)(e.target.value)}
              rows={12}
              spellCheck={false}
              className="mb-4 w-full rounded-lg border border-[#161616]/20 bg-white px-3 py-2 font-mono text-xs leading-relaxed"
            />
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5a5a5a]">
              Text wrapper
            </label>
            <textarea
              value={text}
              onChange={(e) => markDirty(setText)(e.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full rounded-lg border border-[#161616]/20 bg-white px-3 py-2 font-mono text-xs leading-relaxed"
            />
          </div>

          {/* Variables */}
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
            <h3 className="mb-2 text-sm font-semibold">Available placeholders</h3>
            <p className="mb-3 text-xs text-[#5a5a5a]">
              Code renders these blocks and substitutes them in. Unknown{" "}
              <code className="rounded bg-[#161616]/5 px-1">{"{{tokens}}"}</code> render as
              empty — they can never break a send.
            </p>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {selected.variables.map((v) => (
                <div key={v.name} className="text-xs">
                  <dt className="font-mono font-semibold text-[#245c5c]">{"{{"}{v.name}{"}}"}</dt>
                  <dd className="text-[#5a5a5a]">{v.description}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Live preview */}
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Live preview{" "}
                <span className="font-normal text-[#5a5a5a]">
                  (sample data{preview ? ` · rendered from ${preview.template_source}` : ""})
                </span>
              </h3>
              <div className="flex gap-1 rounded-lg bg-[#161616]/5 p-1 text-xs">
                {(["html", "text"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setPreviewTab(t)}
                    className={`rounded-md px-3 py-1 font-medium ${
                      previewTab === t ? "bg-white shadow" : "text-[#5a5a5a]"
                    }`}
                  >
                    {t === "html" ? "HTML" : "Text"}
                  </button>
                ))}
              </div>
            </div>
            {preview ? (
              <>
                <div className="mb-3 rounded-lg bg-white px-3 py-2 font-mono text-xs">
                  <span className="text-[#5a5a5a]">Subject: </span>
                  {preview.subject}
                </div>
                {preview.warnings && (preview.warnings.unknown.length > 0 || preview.warnings.unclosed) && (
                  <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {preview.warnings.unknown.length > 0 &&
                      `Unknown placeholders (render as empty): ${preview.warnings.unknown.join(", ")}. `}
                    {preview.warnings.unclosed && "Unclosed {{ detected — check for typos."}
                  </div>
                )}
                {previewTab === "html" ? (
                  <iframe
                    title="Email HTML preview"
                    srcDoc={preview.html}
                    className="h-[560px] w-full rounded-lg border border-[#161616]/15 bg-white"
                    sandbox=""
                  />
                ) : (
                  <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-lg border border-[#161616]/15 bg-white p-4 text-xs leading-relaxed">
                    {preview.text}
                  </pre>
                )}
              </>
            ) : (
              <div className="py-8 text-center text-xs text-[#5a5a5a]">Rendering preview…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
