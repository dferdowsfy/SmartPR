"use client";

/**
 * Shared shell for the SmartPR rehearsal portal — a FICTIONAL demo portal
 * used only so the Browser Use agent can rehearse a complete filing without
 * a real entity, real credentials, or touching any government system.
 *
 * All state is local (React context). Nothing is persisted, nothing leaves
 * the browser, nothing is submitted anywhere real.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

export type RehearsalLang = "en" | "es";

interface RehearsalState {
  lang: RehearsalLang;
  setLang: (l: RehearsalLang) => void;
  /** t(en, es) — inline bilingual copy. */
  t: (en: string, es: string) => string;
  /** Filing data collected across steps (local only). */
  data: Record<string, string>;
  setField: (key: string, value: string) => void;
}

const RehearsalContext = createContext<RehearsalState | null>(null);

export function useRehearsal(): RehearsalState {
  const ctx = useContext(RehearsalContext);
  if (!ctx) throw new Error("useRehearsal must be used inside RehearsalProvider");
  return ctx;
}

export function RehearsalProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<RehearsalLang>("en");
  const [data, setData] = useState<Record<string, string>>({});
  const t = (en: string, es: string) => (lang === "es" ? es : en);
  const setField = (key: string, value: string) =>
    setData((d) => ({ ...d, [key]: value }));
  return (
    <RehearsalContext.Provider value={{ lang, setLang, t, data, setField }}>
      {children}
    </RehearsalContext.Provider>
  );
}

/** Unmissable fictional-portal banner — rendered on every rehearsal page. */
export function DemoBanner() {
  const { lang, setLang, t } = useRehearsal();
  return (
    <div className="sticky top-0 z-50 border-b-4 border-black bg-amber-300">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-2">
        <span aria-hidden className="text-lg">⚠️</span>
        <p className="flex-1 text-xs font-extrabold uppercase tracking-wide text-black">
          {t(
            "Demo — fictional rehearsal portal. NOT a government website. Nothing filed here is real.",
            "Demo — portal ficticio para ensayos. NO es un sitio del gobierno. Nada de lo que se radique aquí es real."
          )}
        </p>
        <div className="flex overflow-hidden rounded-md border border-black/40 text-xs font-bold">
          {(["en", "es"] as RehearsalLang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`px-2.5 py-1 uppercase ${lang === l ? "bg-black text-amber-300" : "bg-amber-200 text-black"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Machine-readable step for the rehearsal agent (data-smartpr-step). Real
 * portals have no such marker — there the agent identifies the step from
 * the heading, URL and controls — but declaring it here makes the
 * rehearsal's step detection deterministic and testable.
 */
export type RehearsalStep =
  | "landing" | "login" | "form" | "identity" | "certification"
  | "payment" | "review" | "submission";

export function PortalCard({ children, step }: { children: ReactNode; step?: RehearsalStep }) {
  return (
    <main data-smartpr-step={step} className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
      <div className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm md:p-8">
        {children}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        <RehearsalFootNote />
      </p>
    </main>
  );
}

function RehearsalFootNote() {
  const { t } = useRehearsal();
  return (
    <>
      {t(
        "Rehearsal only — this portal is fictional. No data leaves your browser.",
        "Solo ensayo — este portal es ficticio. Ningún dato sale de tu navegador."
      )}
    </>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-extrabold text-slate-900">{children}</h1>;
}

export function PageSub({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm text-slate-600">{children}</p>;
}

export function PrimaryButton({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-1 text-sm font-semibold text-rose-700">
      {children}
    </p>
  );
}

const inputCls =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none";

export function TextInput({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  required,
  autoComplete,
  placeholder,
  hint,
  error,
  inputMode,
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
        {required && <span aria-hidden className="text-rose-600"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        className={`${inputCls} ${error ? "border-rose-500" : ""}`}
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}

export function SelectInput({
  id,
  name,
  label,
  value,
  onChange,
  options,
  required,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
        {required && <span aria-hidden className="text-rose-600"> *</span>}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextAreaInput({
  id,
  name,
  label,
  value,
  onChange,
  required,
  rows = 3,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  rows?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
        {required && <span aria-hidden className="text-rose-600"> *</span>}
      </label>
      <textarea
        id={id}
        name={name}
        value={value}
        required={required}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </div>
  );
}

export function CheckRow({
  id,
  name,
  label,
  checked,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-slate-900"
      />
      <span className="text-sm text-slate-800">{label}</span>
    </label>
  );
}

export function RadioGroup({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <fieldset>
      <legend className="block text-sm font-semibold text-slate-800">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              value === o.value
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-800"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-4 w-4 accent-slate-900"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
