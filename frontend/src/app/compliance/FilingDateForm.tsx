"use client";

/**
 * Add / edit a filing date in the compliance calendar.
 *
 * Fields: which filing (one of the business's tracked filings, or a custom
 * one with name + agency), due date, repeat cadence (custom filings only —
 * tracked filings renew on their regulatory cadence), where the date comes
 * from, reminder schedule (days before), and email on/off. Saves through
 * PATCH /api/obligations/[id] or POST /api/businesses/[id]/obligations; the
 * server schedules the reminders.
 */
import { useId, useMemo, useState } from "react";
import { Bell, Mail, X } from "lucide-react";
import type { Lang } from "../forms/engine/types";
import { REMINDER_DAY_OPTIONS, REMINDER_WINDOWS_DAYS } from "./dates";

export interface FilingOption {
  id: string;
  name: string;
  agency: string | null;
  due_date: string | null;
  source?: string | null;
  renewal_frequency_months?: number | null;
  reminder_days?: number[] | null;
  reminder_email?: boolean | null;
}

const CUSTOM = "__custom__";
const T = (lang: Lang, en: string, es: string) => (lang === "es" ? es : en);

const REPEATS: { months: number | null; en: string; es: string }[] = [
  { months: null, en: "Does not repeat", es: "No se repite" },
  { months: 12, en: "Every year", es: "Cada año" },
  { months: 6, en: "Every 6 months", es: "Cada 6 meses" },
  { months: 3, en: "Every 3 months", es: "Cada 3 meses" },
  { months: 24, en: "Every 2 years", es: "Cada 2 años" },
];

export function reminderLabel(days: number, lang: Lang): string {
  if (days === 0) return T(lang, "On the due date", "El día de vencimiento");
  if (days === 1) return T(lang, "1 day before", "1 día antes");
  return T(lang, `${days} days before`, `${days} días antes`);
}

export function FilingDateForm({
  lang, businessId, filings, initialFilingId, onSaved, onCancel,
}: {
  lang: Lang;
  /** Business UUID (or public id) the filing belongs to. */
  businessId: string;
  /** The business's tracked filings (dated or not), excluding completed ones. */
  filings: FilingOption[];
  initialFilingId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [filingId, setFilingId] = useState(initialFilingId ?? (filings.find((f) => !f.due_date)?.id ?? CUSTOM));
  const picked = useMemo(() => filings.find((f) => f.id === filingId) ?? null, [filings, filingId]);
  const custom = filingId === CUSTOM || picked?.source === "USER_ADDED";
  const [name, setName] = useState("");
  const [agency, setAgency] = useState("");
  const [dueDate, setDueDate] = useState(picked?.due_date ?? "");
  const [repeat, setRepeat] = useState<number | null>(picked?.renewal_frequency_months ?? 12);
  const [fromDocument, setFromDocument] = useState(false);
  const [reference, setReference] = useState("");
  const [reminders, setReminders] = useState<number[]>(picked?.reminder_days ?? [...REMINDER_WINDOWS_DAYS]);
  const [email, setEmail] = useState(picked?.reminder_email ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    setFilingId(id);
    const f = filings.find((x) => x.id === id);
    setDueDate(f?.due_date ?? "");
    setReminders(f?.reminder_days ?? [...REMINDER_WINDOWS_DAYS]);
    setEmail(f?.reminder_email ?? true);
    setRepeat(f ? (f.renewal_frequency_months ?? null) : 12);
  };
  const toggleReminder = (d: number) =>
    setReminders((r) => (r.includes(d) ? r.filter((x) => x !== d) : [...r, d].sort((a, b) => b - a)));

  const today = new Date().toISOString().slice(0, 10);
  const valid = Boolean(dueDate) && (filingId !== CUSTOM || name.trim().length > 0);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const common = {
      due_date: dueDate,
      due_date_source: fromDocument ? "DOCUMENT_EXTRACTED" : "USER_PROVIDED",
      source_reference: reference.trim() || null,
      reminder_days: reminders,
      reminder_email: email,
    };
    try {
      const res = filingId === CUSTOM
        ? await fetch(`/api/businesses/${encodeURIComponent(businessId)}/obligations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...common, name: name.trim(), agency: agency.trim() || null, renewal_frequency_months: repeat }),
          })
        : await fetch(`/api/obligations/${encodeURIComponent(filingId)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(custom ? { ...common, renewal_frequency_months: repeat } : common),
          });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(res.status === 401
          ? T(lang, "Sign in to save filing dates and reminders.", "Inicia sesión para guardar fechas y recordatorios.")
          : j.error || T(lang, "Couldn't save the date. Try again.", "No se pudo guardar la fecha. Intenta de nuevo."));
        setBusy(false);
        return;
      }
      onSaved();
    } catch {
      setError(T(lang, "Couldn't save the date. Check your connection.", "No se pudo guardar. Verifica tu conexión."));
      setBusy(false);
    }
  };

  const label = "block text-sm font-semibold text-[#161616]";
  const input = "mt-1 w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-[15px] text-[#161616] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby={`${uid}-t`} data-testid="filing-date-form">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`${uid}-t`} className="text-base font-bold text-[#161616]">{T(lang, "Add a filing date", "Añadir fecha de radicación")}</h3>
          <p className="mt-0.5 text-sm text-slate-500">{T(lang, "SmartPR tracks it in the calendar and reminds you before it's due.", "SmartPR la sigue en el calendario y te recuerda antes del vencimiento.")}</p>
        </div>
        <button type="button" onClick={onCancel} aria-label={T(lang, "Close", "Cerrar")} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"><X className="h-4 w-4" /></button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-f`} className={label}>{T(lang, "Filing", "Radicación")}</label>
          <select id={`${uid}-f`} value={filingId} onChange={(e) => choose(e.target.value)} className={input} data-testid="filing-date-filing">
            {filings.length > 0 && (
              <optgroup label={T(lang, "Tracked for this business", "En seguimiento para este negocio")}>
                {filings.map((f) => <option key={f.id} value={f.id}>{f.name}{f.due_date ? ` — ${f.due_date}` : ` — ${T(lang, "no date yet", "sin fecha")}`}</option>)}
              </optgroup>
            )}
            <option value={CUSTOM}>{T(lang, "Other filing (add your own)…", "Otra radicación (añadir)…")}</option>
          </select>
        </div>

        {filingId === CUSTOM && (
          <>
            <div>
              <label htmlFor={`${uid}-n`} className={label}>{T(lang, "Filing name", "Nombre")} <span className="text-red-700">*</span></label>
              <input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder={T(lang, "e.g. Fire inspection renewal", "ej. Renovación de inspección de bomberos")} className={input} data-testid="filing-date-name" />
            </div>
            <div>
              <label htmlFor={`${uid}-a`} className={label}>{T(lang, "Agency (optional)", "Agencia (opcional)")}</label>
              <input id={`${uid}-a`} value={agency} onChange={(e) => setAgency(e.target.value)} maxLength={120} placeholder={T(lang, "e.g. Negociado de Bomberos", "ej. Negociado de Bomberos")} className={input} />
            </div>
          </>
        )}

        <div>
          <label htmlFor={`${uid}-d`} className={label}>{T(lang, "Due date", "Fecha de vencimiento")} <span className="text-red-700">*</span></label>
          <input id={`${uid}-d`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} data-testid="filing-date-due" />
          {dueDate && dueDate < today && <p className="mt-1 text-xs font-semibold text-red-700">{T(lang, "This date has passed — it will show as overdue.", "Esta fecha ya pasó — aparecerá como vencida.")}</p>}
        </div>
        {custom ? (
          <div>
            <label htmlFor={`${uid}-r`} className={label}>{T(lang, "Repeats", "Se repite")}</label>
            <select id={`${uid}-r`} value={repeat ?? ""} onChange={(e) => setRepeat(e.target.value ? Number(e.target.value) : null)} className={input} data-testid="filing-date-repeat">
              {REPEATS.map((r) => <option key={r.en} value={r.months ?? ""}>{T(lang, r.en, r.es)}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">{T(lang, "When you mark it done, the next date is added automatically.", "Al marcarla completada, se añade la próxima fecha automáticamente.")}</p>
          </div>
        ) : (
          <div className="text-sm text-slate-500 sm:pt-7">
            {picked?.renewal_frequency_months
              ? T(lang, `Renews every ${picked.renewal_frequency_months} months under its official rule.`, `Se renueva cada ${picked.renewal_frequency_months} meses según su regla oficial.`)
              : T(lang, "Renewal follows the agency's rule.", "La renovación sigue la regla de la agencia.")}
          </div>
        )}

        <fieldset className="sm:col-span-2">
          <legend className={label}>{T(lang, "Where does this date come from?", "¿De dónde sale esta fecha?")}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {[false, true].map((doc) => (
              <label key={String(doc)} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${fromDocument === doc ? "border-brand bg-brand/5 font-semibold text-brand" : "border-slate-300 text-slate-700"}`}>
                <input type="radio" name={`${uid}-src`} checked={fromDocument === doc} onChange={() => setFromDocument(doc)} className="accent-brand" />
                {doc ? T(lang, "A document or agency notice", "Un documento o aviso de la agencia") : T(lang, "I know this date", "Conozco esta fecha")}
              </label>
            ))}
          </div>
          {fromDocument && (
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={300} placeholder={T(lang, "Which document? e.g. Permit #12345, expires on the certificate", "¿Qué documento? ej. Permiso #12345")} className={input} aria-label={T(lang, "Document reference", "Referencia del documento")} />
          )}
        </fieldset>

        <fieldset className="sm:col-span-2">
          <legend className={`${label} flex items-center gap-1.5`}><Bell className="h-4 w-4 text-brand" aria-hidden="true" /> {T(lang, "Remind me", "Recordarme")}</legend>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="filing-date-reminders">
            {REMINDER_DAY_OPTIONS.map((d) => {
              const on = reminders.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => toggleReminder(d)} data-days={d} className={`min-h-10 rounded-full border px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${on ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-600 hover:border-brand"}`}>
                  {reminderLabel(d, lang)}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500">{reminders.length === 0 ? T(lang, "No reminders — the date still shows in the calendar.", "Sin recordatorios — la fecha sigue en el calendario.") : T(lang, "Recommended: 60, 30 and 7 days before.", "Recomendado: 60, 30 y 7 días antes.")}</p>
        </fieldset>

        <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-[#F7F5EF] p-3">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="mt-1 h-4 w-4 accent-brand" data-testid="filing-date-email" />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-[#161616]"><Mail className="h-4 w-4 text-brand" aria-hidden="true" /> {T(lang, "Email me these reminders", "Enviarme estos recordatorios por correo")}</span>
            <span className="block text-xs text-slate-500">{email ? T(lang, "Sent to your account email at 9:00 AM. You can mute reminders anytime in notification settings.", "Se envían a tu correo de la cuenta a las 9:00 AM. Puedes silenciarlos en la configuración de notificaciones.") : T(lang, "Reminders appear in SmartPR only (History & Notifications).", "Los recordatorios aparecen solo en SmartPR (Historial y notificaciones).")}</span>
          </span>
        </label>
      </div>

      {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">{T(lang, "Cancel", "Cancelar")}</button>
        <button type="button" onClick={() => void save()} disabled={!valid || busy} className="min-h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50" data-testid="filing-date-save">
          {busy ? T(lang, "Saving…", "Guardando…") : T(lang, "Save date", "Guardar fecha")}
        </button>
      </div>
    </section>
  );
}
