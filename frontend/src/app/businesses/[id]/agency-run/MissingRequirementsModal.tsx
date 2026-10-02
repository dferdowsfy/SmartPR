"use client";

/**
 * Complete a Clara workflow's missing requirements without leaving Clara.
 *
 * Shows ONLY the blockers of the selected workflow (missingFieldsFor) — never
 * the whole Business Passport. Values are saved by the page's onSave, which
 * writes the canonical Passport (PATCH /api/businesses/[id], mergePassport)
 * and then re-reads workflow eligibility. On failure the modal stays open
 * with every entered value intact. Cancel / Escape write nothing.
 *
 * Dialog semantics: role=dialog + aria-modal, labelled heading, focus trapped
 * inside, Escape closes, focus returns to the button that opened it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import type { FilingOption } from "../../../../lib/agency-runs/agencyActions";
import { missingFieldsFor, validateMissingValue, type MissingFieldSpec } from "../../../../lib/agency-runs/missingRequirements";
import { CLARA_BTN, CLARA_BTN_PRIMARY } from "./claraStyles";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export type SaveResult = { ok: true } | { ok: false; stage: "save" | "refresh" };

export function MissingRequirementsModal({
  lang, filing, onClose, onSave, returnFocus,
}: {
  lang: Lang;
  filing: FilingOption;
  onClose: () => void;
  onSave: (specs: MissingFieldSpec[], values: Record<string, string>) => Promise<SaveResult>;
  returnFocus: HTMLElement | null;
}) {
  const specs = useMemo(() => missingFieldsFor(filing), [filing]);
  const prereqs = filing.action?.blocked_by ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<"save" | "refresh" | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const errors = Object.fromEntries(specs.map((s) => [s.key, validateMissingValue(s, values[s.key] ?? "")]));
  const valid = specs.length > 0 && specs.every((s) => !errors[s.key]);
  const total = specs.length + prereqs.length;
  const title = lang === "es" ? filing.action?.title_es ?? filing.title_es : filing.action?.title_en ?? filing.title_en;

  const close = () => {
    onClose();
    returnFocus?.focus();
  };

  useEffect(() => {
    const root = dialogRef.current;
    root?.querySelector<HTMLElement>("input,select,button[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]),input,select,textarea,a[href]"));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per open
  }, []);

  const submit = async () => {
    setTouched(Object.fromEntries(specs.map((s) => [s.key, true])));
    if (!valid || saving) return;
    setSaving(true);
    setFailure(null);
    const r = await onSave(specs, values);
    setSaving(false);
    if (r.ok) close();
    else setFailure(r.stage);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0F172A]/40 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) close(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clara-mr-title"
        aria-describedby="clara-mr-sub"
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-[#D7DEE8] bg-[#FFFEFB] shadow-[0_12px_40px_rgba(15,23,42,0.18)] sm:max-w-[620px] sm:rounded-[22px]"
        data-testid="clara-missing-modal"
      >
        <div className="flex items-start gap-3 px-6 pb-2 pt-6">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#64748B]">{title}</p>
            <h2 id="clara-mr-title" className="mt-0.5 text-[22px] font-bold leading-tight text-[#0F172A]">
              {total === 1 ? L("Complete 1 item to start this filing", "Completa 1 dato para empezar este trámite", lang) : L(`Complete ${total} items to start this filing`, `Completa ${total} datos para empezar este trámite`, lang)}
            </h2>
            <p id="clara-mr-sub" className="mt-1 text-[14px] text-[#64748B]">
              {L("Clara only needs these remaining items before this workflow can start. They're saved to your Business Passport.", "Clara solo necesita estos datos antes de empezar este trámite. Se guardan en tu Pasaporte del negocio.", lang)}
            </p>
          </div>
          <button type="button" onClick={close} disabled={saving} className="rounded-full p-2 text-[#64748B] hover:bg-[#F1F5F9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]" aria-label={L("Close", "Cerrar", lang)} data-testid="clara-missing-close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="min-h-0 flex-1 overflow-y-auto px-6 py-3"
          noValidate
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          id="clara-mr-form"
        >
          <div className="space-y-4">
            {specs.map((s) => (
              <Field key={s.key} spec={s} lang={lang} value={values[s.key] ?? ""} error={touched[s.key] ? errors[s.key] : null}
                onChange={(v) => setValues((cur) => ({ ...cur, [s.key]: v }))}
                onBlur={() => setTouched((t) => ({ ...t, [s.key]: true }))} />
            ))}
          </div>
          {prereqs.length > 0 && (
            <div className="mt-4 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-[14px] text-[#334155]" data-testid="clara-missing-prereqs">
              <p className="font-semibold">{L("Finish first", "Completa antes", lang)}</p>
              <ul className="mt-1 list-disc pl-5">
                {prereqs.map((p) => <li key={p}>{p.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</li>)}
              </ul>
              <p className="mt-1 text-[13px] text-[#64748B]">{L("This filing depends on another filing being done.", "Este trámite depende de que otro esté hecho.", lang)}</p>
            </div>
          )}
          {failure && (
            <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[14px] text-rose-800" data-testid="clara-missing-error">
              {failure === "save"
                ? L("We couldn't save these updates. Try again.", "No pudimos guardar estos cambios. Inténtalo otra vez.", lang)
                : L("Saved to your Business Passport, but we couldn't refresh your filings. Try again.", "Se guardó en tu Pasaporte del negocio, pero no pudimos actualizar tus trámites. Inténtalo otra vez.", lang)}
            </p>
          )}
        </form>

        <div className="flex justify-end gap-3 border-t border-[#EEF1F5] px-6 py-4">
          <button type="button" onClick={close} disabled={saving} className={`${CLARA_BTN} px-5 py-2.5 text-[15px] font-semibold text-[#0F172A]`} data-testid="clara-missing-cancel">
            {L("Cancel", "Cancelar", lang)}
          </button>
          {specs.length > 0 && (
            <button type="submit" form="clara-mr-form" disabled={saving || !valid} className={`${CLARA_BTN_PRIMARY} px-5 py-2.5 text-[15px]`} data-testid="clara-missing-save">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {failure === "refresh" ? L("Retry", "Reintentar", lang) : L("Save & continue", "Guardar y continuar", lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ spec, lang, value, error, onChange, onBlur }: { spec: MissingFieldSpec; lang: Lang; value: string; error: { en: string; es: string } | null; onChange: (v: string) => void; onBlur: () => void }) {
  const id = `clara-mr-${spec.key.replace(/\W/g, "-")}`;
  const cls = `mt-1.5 block w-full rounded-xl border bg-white px-3.5 py-2.5 text-[15px] text-[#0F172A] shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#93B4FF] ${error ? "border-rose-400" : "border-[#D7DEE8] hover:border-[#B8C4D4] focus:border-[#2563EB]"}`;
  const describedBy = [spec.help ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const common = { id, name: spec.key, value, onBlur, "aria-invalid": Boolean(error), "aria-describedby": describedBy, "aria-required": true, "data-field": spec.key } as const;
  return (
    <div>
      <label htmlFor={id} className="text-[14px] font-semibold text-[#0F172A]">{L(spec.label.en, spec.label.es, lang)}</label>
      {spec.help && <p id={`${id}-help`} className="text-[13px] text-[#64748B]">{L(spec.help.en, spec.help.es, lang)}</p>}
      {spec.kind === "select" ? (
        <select {...common} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">{L("Choose…", "Escoge…", lang)}</option>
          {spec.options?.map((o) => <option key={o.value} value={o.value}>{L(o.label.en, o.label.es, lang)}</option>)}
        </select>
      ) : (
        <input
          {...common}
          type={spec.kind === "email" ? "email" : spec.kind === "phone" ? "tel" : "text"}
          inputMode={spec.kind === "postal" || spec.kind === "ein" ? "numeric" : undefined}
          autoComplete={spec.autoComplete ?? "off"}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      )}
      {error && <p id={`${id}-err`} className="mt-1 text-[13px] text-rose-700" data-testid="clara-missing-field-error">{L(error.en, error.es, lang)}</p>}
    </div>
  );
}
