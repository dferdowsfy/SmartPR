"use client";

// "Complete form" for a requirement without a dedicated SmartPR form: a
// guided in-platform form built from the requirement's "What you'll need"
// (guidedFormModel.ts), the business's details prefilled. The draft is kept
// in SmartPR; "Download package" builds the filled package as a PDF in the
// browser; "Fill with Clara" hands it to Clara when she can file it. The
// official portal is only a secondary link at the bottom.

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, ExternalLink, GraduationCap, Paperclip, Sparkles } from "lucide-react";
import { ClaraModal } from "./ClaraModal";
import { draftStorageKey, emptyDraft, guidedFormSections, guidedProgress, type GuidedDraft, type GuidedSubject } from "./guidedFormModel";
import { useRequirementActionsEnv } from "./requirementActionsContext";

type Language = "en" | "es";

function loadDraft(key: string): GuidedDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as GuidedDraft) : null;
  } catch {
    return null;
  }
}

export function GuidedRequirementForm({
  subject,
  language,
  onClose,
  onFillWithClara,
  onTeach,
}: {
  subject: GuidedSubject;
  language: Language;
  onClose: () => void;
  /** Clara can file this requirement: hand the package to her. */
  onFillWithClara?: (() => void) | null;
  onTeach?: (() => void) | null;
}) {
  const es = language === "es";
  const T = (en: string, sp: string) => (es ? sp : en);
  const env = useRequirementActionsEnv();
  const sections = useMemo(() => guidedFormSections(subject, language), [subject, language]);
  const storageKey = draftStorageKey(env.businessId, subject.key);
  const [draft, setDraft] = useState<GuidedDraft>(() => {
    const blank = emptyDraft(sections, env.prefill);
    const saved = typeof window !== "undefined" ? loadDraft(storageKey) : null;
    return saved ? { ...saved, values: { ...blank.values, ...saved.values } } : blank;
  });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(draft));
        setSavedAt(new Date().toLocaleTimeString(es ? "es-PR" : "en-US", { hour: "numeric", minute: "2-digit" }));
      } catch {
        // storage full / disabled: the form still works for this visit
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft, storageKey, es]);

  const progress = guidedProgress(sections, draft);
  const set = (id: string, v: string) => setDraft((d) => ({ ...d, values: { ...d.values, [id]: v }, status: "draft", updatedAt: new Date().toISOString() }));
  const attach = (id: string, files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).map((f) => ({ name: f.name, size: f.size }));
    setDraft((d) => ({ ...d, files: { ...d.files, [id]: [...(d.files[id] ?? []), ...list] }, updatedAt: new Date().toISOString() }));
  };
  const toggleHave = (id: string) => setDraft((d) => ({ ...d, have: { ...d.have, [id]: !d.have[id] } }));
  const ready = progress.total > 0 && progress.done === progress.total;

  const downloadPackage = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    let y = 56;
    const line = (text: string, size = 11, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      for (const l of doc.splitTextToSize(text, 500) as string[]) {
        if (y > 740) { doc.addPage(); y = 56; }
        doc.text(l, 56, y);
        y += size + 5;
      }
    };
    line(subject.name, 16, true);
    if (subject.agency) line(subject.agency, 11);
    line(`${T("Prepared in SmartPR", "Preparado en SmartPR")} · ${new Date().toLocaleDateString(es ? "es-PR" : "en-US")}`, 9);
    y += 8;
    for (const s of sections) {
      line(s.title, 13, true);
      for (const f of s.fields) {
        const v = f.kind === "document"
          ? [...(draft.files[f.id] ?? []).map((x) => x.name), draft.have[f.id] ? T("(on hand)", "(disponible)") : ""].filter(Boolean).join(", ")
          : draft.values[f.id] ?? "";
        line(`${f.label}: ${v || "—"}`, 10);
      }
      y += 6;
    }
    doc.save(`${subject.name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}_SmartPR.pdf`);
  };

  return (
    <ClaraModal
      title={subject.name}
      subtitle={[subject.agency, T("Complete it here — SmartPR keeps your draft.", "Complétalo aquí — SmartPR guarda tu borrador.")].filter(Boolean).join(" · ")}
      onClose={onClose}
      testId="guided-form"
      wide
      footer={
        <>
          <span className="cl-progress" data-testid="guided-progress">
            {ready ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
            {T(`${progress.done} of ${progress.total} done`, `${progress.done} de ${progress.total} listos`)}
            {savedAt && <span className="cl-muted"> · {T("Saved", "Guardado")} {savedAt}</span>}
          </span>
          <span className="cl-foot-actions">
            <button type="button" className="cl-btn cl-btn-ghost" onClick={downloadPackage} data-testid="guided-download">
              <Download size={15} aria-hidden="true" /> {T("Download package", "Descargar paquete")}
            </button>
            {onFillWithClara ? (
              <button type="button" className="cl-btn" onClick={() => { onClose(); onFillWithClara(); }} data-testid="guided-clara">
                <Sparkles size={15} aria-hidden="true" /> {T("Fill with Clara", "Llenar con Clara")}
              </button>
            ) : (
              <button type="button" className="cl-btn" onClick={() => { setDraft((d) => ({ ...d, status: "ready" })); onClose(); }} data-testid="guided-done">
                <CheckCircle2 size={15} aria-hidden="true" /> {T("Save", "Guardar")}
              </button>
            )}
          </span>
        </>
      }
    >
      {sections.map((s) => (
        <fieldset key={s.id} className="cl-section" data-section={s.id}>
          <legend>{s.title}</legend>
          {s.fields.map((f) => (
            <div key={f.id} className={`cl-field cl-field-${f.kind}`}>
              <label htmlFor={`gf-${subject.key}-${f.id}`}>
                {f.label}{f.required && <span className="cl-req" aria-hidden="true"> *</span>}
              </label>
              {f.kind === "text" && (
                <input id={`gf-${subject.key}-${f.id}`} value={draft.values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} />
              )}
              {f.kind === "textarea" && (
                <textarea id={`gf-${subject.key}-${f.id}`} rows={2} value={draft.values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} />
              )}
              {f.kind === "document" && (
                <div className="cl-doc">
                  <label className="cl-btn cl-btn-ghost cl-attach">
                    <Paperclip size={15} aria-hidden="true" /> {T("Attach", "Adjuntar")}
                    <input id={`gf-${subject.key}-${f.id}`} type="file" multiple onChange={(e) => attach(f.id, e.target.files)} />
                  </label>
                  <label className="cl-check">
                    <input type="checkbox" checked={!!draft.have[f.id]} onChange={() => toggleHave(f.id)} /> {T("I have it", "Lo tengo")}
                  </label>
                  {(draft.files[f.id] ?? []).length > 0 && (
                    <span className="cl-files">{draft.files[f.id].map((x) => x.name).join(", ")}</span>
                  )}
                </div>
              )}
              {f.hint && <span className="cl-hint">{f.hint}</span>}
            </div>
          ))}
        </fieldset>
      ))}
      <div className="cl-secondary">
        {onTeach && (
          <button type="button" className="cl-link" onClick={() => { onClose(); onTeach(); }} data-testid="guided-teach">
            <GraduationCap size={15} aria-hidden="true" /> {T("Teach Clara how this one is filed", "Enséñale a Clara cómo se radica")}
          </button>
        )}
        {subject.portalUrl && (
          <a className="cl-link" href={subject.portalUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" /> {subject.portalLabel || T("Official portal", "Portal oficial")}
          </a>
        )}
      </div>
    </ClaraModal>
  );
}
