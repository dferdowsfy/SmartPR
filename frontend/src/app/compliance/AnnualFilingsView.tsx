"use client";

/**
 * Annual filings — one view used by the /filings page and inside the
 * business dashboard. Counting and grouping are the page's original code
 * (compliance/annualFilings), unchanged.
 */
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { StatusBadge } from "../components/compliance/StatusBadge";
import { L } from "../i18n";
import type { Lang } from "../forms/engine/types";
import { countFilings, filingYear, groupAnnualFilings, type FilingLike } from "./annualFilings";

export interface FilingsPortfolio {
  businesses?: { id: string; legal_name: string }[];
  items?: FilingLike[];
}

function RowAction({ href, onClick, className, children }: { href: string; onClick?: () => void; className: string; children: ReactNode }) {
  return onClick
    ? <button type="button" onClick={onClick} className={className} data-testid="filing-row">{children}</button>
    : <Link href={href} className={className} data-testid="filing-row">{children}</Link>;
}

export function AnnualFilingsView({
  data, lang, initialBusiness = "", lockedBusinessId, onOpenItem, onShowCalendar, embedded = false,
}: {
  data: FilingsPortfolio | null;
  lang: Lang;
  initialBusiness?: string;
  lockedBusinessId?: string[];
  onOpenItem?: (item: FilingLike) => void;
  onShowCalendar?: () => void;
  embedded?: boolean;
}) {
  const es = lang === "es";
  const [pickedBusiness, setBusiness] = useState(initialBusiness);
  const ids = lockedBusinessId ?? (pickedBusiness ? [pickedBusiness] : null);
  const idsKey = ids?.join(",") ?? "";
  const filings = useMemo(() => {
    const keys = idsKey ? idsKey.split(",") : null;
    const items = (data?.items ?? []).filter((item) => !keys || keys.includes(item.business_id) || (item.business_public_id != null && keys.includes(item.business_public_id)));
    return items;
  }, [data, idsKey]);

  const counts = useMemo(() => countFilings(filings), [filings]);
  const groups = useMemo(() => groupAnnualFilings(filings), [filings]);

  return (
    <div data-testid="annual-filings-view">
        {!embedded && (
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">{L("Recurring compliance", lang)}</p>
            <h1 className="mt-1 text-3xl font-bold text-[#161616]">{L("Annual filings", lang)}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              {L("Every yearly filing for every business — Informe Anual, Patente, CRIM — in one place. SmartPR reminds you 90, 60, 30 and 7 days out, and queues next year's filing the moment you complete this one.", lang)}
            </p>
          </div>
          {!lockedBusinessId && <select value={pickedBusiness} onChange={(event) => setBusiness(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-[#161616]" aria-label={L("Filter by business", lang)}>
            <option value="">{L("All businesses", lang)}</option>
            {data?.businesses?.map((item) => <option key={item.id} value={item.id}>{item.legal_name}</option>)}
          </select>}
        </div>
        )}

        <div className={`${embedded ? "" : "mt-6 "}flex flex-wrap gap-2`} data-testid="filings-counts">
          {[
            { key: "overdue", label: L("Overdue", lang), value: counts.overdue, tone: "text-red-700 bg-red-50 border-red-200" },
            { key: "dueSoon", label: L("Due soon", lang), value: counts.dueSoon, tone: "text-amber-800 bg-amber-50 border-amber-200" },
            { key: "upcoming", label: L("Upcoming", lang), value: counts.upcoming, tone: "text-slate-600 bg-white border-slate-200" },
            { key: "filed", label: L("Filed", lang), value: counts.filed, tone: "text-emerald-800 bg-emerald-50 border-emerald-200" },
          ].map((chip) => (
            <span key={chip.key} className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${chip.tone}`}>
              {chip.label}
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold tabular-nums">{chip.value}</span>
            </span>
          ))}
        </div>

        <div className="mt-4 text-sm text-slate-500">
          <span><span className="font-bold text-[#161616] tabular-nums">{counts.total}</span> {es ? `radicación${counts.total === 1 ? "" : "es"} anual${counts.total === 1 ? "" : "es"} en seguimiento` : `annual filing${counts.total === 1 ? "" : "s"} tracked`}</span>
{!embedded && (<>
          <span className="mx-2 text-slate-300">·</span>
          {onShowCalendar
            ? <button type="button" onClick={onShowCalendar} className="font-semibold text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">{L("View full compliance calendar →", lang)}</button>
            : <Link href="/calendar" className="font-semibold text-brand hover:underline">{L("View full compliance calendar →", lang)}</Link>}
          </>)}
        </div>

        {data === null ? (
          <div className="py-14 text-center text-slate-500">{L("Loading filings…", lang)}</div>
        ) : groups.length === 0 ? (
          <div className="py-14 text-center">
            <FileCheck2 className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <div className="font-semibold text-[#161616]">{L("No annual filings tracked yet.", lang)}</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              {L("Annual filings appear here once your businesses have obligations with a yearly renewal — for example the Informe Anual or the municipal Patente.", lang)}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {groups.map((group) => (
              <section key={group.business_id}>
                {!lockedBusinessId && <h2 className="text-lg font-bold text-[#161616]">{group.business_name}</h2>}
                <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {group.filings.map((filing) => {
                    const filed = filing.status === "COMPLETED";
                    const year = filingYear(filing.due_date);
                    return (
                      <RowAction
                        key={filing.id}
                        href={`/businesses/${group.business_public_id || filing.business_id}#obligation-${filing.id}`}
                        onClick={onOpenItem ? () => onOpenItem(filing) : undefined}
                        className={`grid w-full gap-3 px-5 py-4 text-left hover:bg-[#f4f1ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:grid-cols-[80px_1fr_auto] sm:items-center ${filed ? "opacity-60" : ""}`}
                      >
                        <div className="rounded-xl bg-slate-100 py-2 text-center">
                          {filing.due_date ? (
                            <>
                              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                {new Date(`${filing.due_date}T00:00:00`).toLocaleDateString(es ? "es-PR" : "en-US", { month: "short" })}
                              </div>
                              <div className="text-xl font-extrabold text-[#161616]">{new Date(`${filing.due_date}T00:00:00`).getDate()}</div>
                            </>
                          ) : (
                            <div className="py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{L("No date", lang)}</div>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-[#161616]">
                            {filing.name}
                            {year && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{year}</span>}
                          </div>
                          <div className="text-xs text-slate-500">{filing.agency || L("Agency not recorded", lang)} · {L("renews every year", lang)}</div>
                        </div>
                        <StatusBadge status={filing.status} lang={lang} />
                      </RowAction>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
    </div>
  );
}
