"use client";

/**
 * Compliance calendar — one view used by the /calendar page and inside the
 * business dashboard. Filtering, horizon counts and overdue logic are the
 * page's original code, moved here unchanged.
 *
 * - `lockedBusinessId`: show one business only (no business picker).
 * - `onOpenItem`: open an item in place (dashboard) instead of linking to
 *   the business page.
 * - `onShowFilings`: switch to the annual-filings view in place.
 */
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CalendarPlus } from "lucide-react";
import { FilingDateForm } from "./FilingDateForm";
import { StatusBadge } from "../components/compliance/StatusBadge";
import { L } from "../i18n";
import type { Lang } from "../forms/engine/types";
import type { ObligationStatus } from "./types";

export interface CalendarEventItem {
  id: string;
  business_id: string;
  business_public_id: string | null;
  business_name: string;
  name: string;
  agency: string | null;
  due_date: string | null;
  status: ObligationStatus;
  matter_title: string | null;
  reminder_scheduled_for: string | null;
  item_type?: string;
  source?: string | null;
  renewal_frequency_months?: number | null;
  reminder_days?: number[] | null;
  reminder_email?: boolean | null;
}

export interface PortfolioData {
  businesses?: { id: string; legal_name: string }[];
  items?: CalendarEventItem[];
}

export const HORIZONS = [7, 30, 60, 90, 365] as const;
export type Horizon = (typeof HORIZONS)[number] | "all";

export function ComplianceCalendarView({
  data, lang, initialBusiness = "", lockedBusinessId, onOpenItem, onShowFilings, embedded = false, addForBusinessId, onChanged,
}: {
  /** Business the "Add filing date" form saves to (dashboard). Omit to hide it. */
  addForBusinessId?: string;
  /** Reload the calendar data after a date is saved. */
  onChanged?: () => void;
  data: PortfolioData | null;
  lang: Lang;
  initialBusiness?: string;
  lockedBusinessId?: string[];
  onOpenItem?: (item: CalendarEventItem) => void;
  onShowFilings?: () => void;
  embedded?: boolean;
}) {
  const es = lang === "es";
  const [adding, setAdding] = useState(false);
  const [horizon, setHorizon] = useState<Horizon>("all");
  const [pickedBusiness, setBusiness] = useState(initialBusiness);
  const ids = lockedBusinessId ?? (pickedBusiness ? [pickedBusiness] : null);
  const idsKey = ids?.join(",") ?? "";
  const inBusiness = useCallback((item: CalendarEventItem) => {
    const keys = idsKey ? idsKey.split(",") : null;
    return !keys || keys.includes(item.business_id) || (item.business_public_id != null && keys.includes(item.business_public_id));
  }, [idsKey]);
  const trackedFilings = useMemo(() => (data?.items ?? [])
    .filter((item) => inBusiness(item) && item.status !== "COMPLETED" && (item.item_type ?? "OBLIGATION") === "OBLIGATION")
    .map((item) => ({ id: item.id, name: item.name, agency: item.agency, due_date: item.due_date, source: item.source ?? null, renewal_frequency_months: item.renewal_frequency_months ?? null, reminder_days: item.reminder_days ?? null, reminder_email: item.reminder_email ?? null }))
    .sort((a, b) => Number(!!a.due_date) - Number(!!b.due_date) || a.name.localeCompare(b.name)), [data, inBusiness]);
  const events = useMemo(() => {
    const today = new Date();
    return (data?.items ?? []).filter((item) => {
      if (!item.due_date || item.status === "COMPLETED") return false;
      // Accept either the UUID or the short public id (?business= can carry either).
      if (!inBusiness(item)) return false;
      if (horizon === "all") return true;
      const days = Math.ceil((new Date(`${item.due_date}T23:59:59`).getTime() - today.getTime()) / 86400000);
      return days <= horizon;
    }).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  }, [data, horizon, inBusiness]);

  // How many items fall inside each horizon, so the pills carry a count
  // instead of just a label — same business filter as the list below.
  const horizonCounts = useMemo(() => {
    const today = new Date();
    const withinBusiness = (data?.items ?? []).filter((item) => {
      if (!item.due_date || item.status === "COMPLETED") return false;
      // Accept either the UUID or the short public id (?business= can carry either).
      if (!inBusiness(item)) return false;
      return true;
    });
    const counts = new Map<Horizon, number>();
    for (const days of HORIZONS) {
      counts.set(
        days,
        withinBusiness.filter((item) => {
          const remaining = Math.ceil((new Date(`${item.due_date}T23:59:59`).getTime() - today.getTime()) / 86400000);
          return remaining <= days;
        }).length
      );
    }
    counts.set("all", withinBusiness.length);
    return counts;
  }, [data, inBusiness]);
  const overdueCount = useMemo(() => events.filter((item) => {
    const days = Math.ceil((new Date(`${item.due_date}T23:59:59`).getTime() - new Date().getTime()) / 86400000);
    return days < 0;
  }).length, [events]);

  const horizonLabel = (key: Horizon): string => {
    if (key === "all") return L("All dates", lang);
    if (key === 365) return L("Annual horizon", lang);
    return es ? `${key} días` : `${key} days`;
  };

  return (
    <div data-testid="compliance-calendar-view">
        {!embedded && (
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">{L("Due dates", lang)}</p><h1 className="mt-1 text-3xl font-bold text-[#161616]">{L("Compliance calendar", lang)}</h1><p className="mt-1 text-sm text-slate-500">{L("Portfolio-level deadlines linked to the relevant business and obligation.", lang)}</p></div>
          {!lockedBusinessId && <select value={pickedBusiness} onChange={(event) => setBusiness(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-[#161616]"><option value="">{L("All businesses", lang)}</option>{data?.businesses?.map((item) => <option key={item.id} value={item.id}>{item.legal_name}</option>)}</select>}
        </div>
        )}
        {!embedded && (
        <div className="mt-3 text-sm">
          {onShowFilings
            ? <button type="button" onClick={onShowFilings} className="font-semibold text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">{L("View annual filings →", lang)}</button>
            : <Link href="/filings" className="font-semibold text-brand hover:underline">{L("View annual filings →", lang)}</Link>}
          <span className="ml-2 text-slate-400">{L("yearly renewals like Informe Anual and Patente, in one place.", lang)}</span>
        </div>
        )}
        <div className={`${embedded ? "" : "mt-6"} flex flex-wrap gap-2`} role="group" aria-label={es ? "Horizonte" : "Horizon"} data-testid="calendar-horizons">{[...HORIZONS.map((days) => ({ key: days as Horizon })), { key: "all" as Horizon }].map(({ key }) => {
          const active = horizon === key;
          const count = horizonCounts.get(key) ?? 0;
          return (
            <button key={key} type="button" aria-pressed={active} onClick={() => setHorizon(key)} data-horizon={key} className={`flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${active ? "bg-[#161616] text-white" : "border border-slate-300 bg-white text-slate-600"}`}>
              <span>{horizonLabel(key)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
            </button>
          );
        })}</div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-500" data-testid="calendar-count">
          <span><span className="font-bold text-[#161616] tabular-nums">{events.length}</span> {es ? `vencimiento${events.length === 1 ? "" : "s"} en este horizonte` : `item${events.length === 1 ? "" : "s"} in this horizon`}</span>
          {overdueCount > 0 && <span className="flex items-center gap-1.5 font-semibold text-red-700"><span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold tabular-nums">{overdueCount}</span> {L("overdue", lang)}</span>}
          {addForBusinessId && !adding && (
            <button type="button" onClick={() => setAdding(true)} data-testid="calendar-add-date" className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand/40 bg-white px-4 text-sm font-semibold text-brand hover:bg-brand/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <CalendarPlus className="h-4 w-4" aria-hidden="true" /> {es ? "Añadir fecha de radicación" : "Add filing date"}
            </button>
          )}
        </div>
        {addForBusinessId && adding && (
          <div className="mt-4">
            <FilingDateForm
              lang={lang}
              businessId={addForBusinessId}
              filings={trackedFilings}
              onCancel={() => setAdding(false)}
              onSaved={() => { setAdding(false); setHorizon("all"); onChanged?.(); }}
            />
          </div>
        )}
        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {data === null ? <div className="py-14 text-center text-slate-500">{L("Loading calendar…", lang)}</div> : events.length === 0 ? <div className="py-14 text-center"><CalendarDays className="mx-auto mb-3 h-9 w-9 text-slate-300" /><div className="font-semibold text-[#161616]">{L("No due dates in this horizon.", lang)}</div><p className="mt-1 text-sm text-slate-500">{L("Dates stay unset until documentation or a sourced date is provided.", lang)}</p>{addForBusinessId && !adding && <button type="button" onClick={() => setAdding(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white"><CalendarPlus className="h-4 w-4" aria-hidden="true" /> {es ? "Añadir fecha de radicación" : "Add filing date"}</button>}</div> : <div className="divide-y divide-slate-100">{events.map((item) => {
            const date = new Date(`${item.due_date}T00:00:00`);
            const reminderDays = item.reminder_scheduled_for
              ? Math.ceil((new Date(item.reminder_scheduled_for).getTime() - new Date().getTime()) / 86400000)
              : null;
            const rowCls = "grid w-full gap-3 px-5 py-4 text-left hover:bg-[#f4f1ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:grid-cols-[80px_1fr_auto] sm:items-center";
            const content = <><div className="rounded-xl bg-slate-100 py-2 text-center"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{date.toLocaleDateString(es ? "es-PR" : "en-US", { month: "short" })}</div><div className="text-xl font-extrabold text-[#161616]">{date.getDate()}</div></div><div><div className="font-bold text-[#161616]">{item.name}</div><div className="text-xs text-slate-500">{item.business_name} · {item.agency || L("Agency not recorded", lang)}{item.matter_title ? ` · ${item.matter_title}` : ""}</div>{reminderDays !== null && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                <span aria-hidden>🔔</span>
                {reminderDays <= 0
                  ? (es ? "recordatorio hoy" : "reminder today")
                  : es ? `recordatorio en ${reminderDays} día${reminderDays === 1 ? "" : "s"}` : `reminds in ${reminderDays} day${reminderDays === 1 ? "" : "s"}`}
              </div>
            )}</div><StatusBadge status={item.status} lang={lang} /></>;
            return onOpenItem
              ? <button key={item.id} type="button" onClick={() => onOpenItem(item)} className={rowCls} data-testid="calendar-row">{content}</button>
              : <Link key={item.id} href={`/businesses/${item.business_public_id || item.business_id}#obligation-${item.id}`} className={rowCls} data-testid="calendar-row">{content}</Link>;
          })}</div>}
        </section>
    </div>
  );
}
