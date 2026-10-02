"use client";

/**
 * The full compliance calendar and annual filings, inside the business
 * dashboard's content panel (no separate page). Same views and data as
 * /calendar and /filings — /api/portfolio, locked to this business — so the
 * horizon filters (7, 30, 60, 90, annual, all), counts, results and the
 * annual-filing statuses are identical. Opening an item stays in the
 * dashboard: it reveals that requirement in the "All requirements" list,
 * where its actions (upload, update date, mark complete…) live.
 */
import { useEffect, useState } from "react";
import type { Lang } from "../forms/engine/types";
import { ComplianceCalendarView, type PortfolioData } from "../compliance/ComplianceCalendarView";
import { AnnualFilingsView, type FilingsPortfolio } from "../compliance/AnnualFilingsView";

export type ComplianceTab = "calendar" | "filings";

export function DashboardCompliance({
  lang, businessIds, tab, onTab, onOpenObligation,
}: {
  lang: Lang;
  /** UUID and public id of this business. */
  businessIds: string[];
  tab: ComplianceTab;
  onTab: (tab: ComplianceTab) => void;
  onOpenObligation: (obligationId: string) => void;
}) {
  const [data, setData] = useState<PortfolioData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/portfolio", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setData(j); })
      .catch(() => { if (!cancelled) setData({}); });
    return () => { cancelled = true; };
  }, []);
  const es = lang === "es";
  const tabs: { key: ComplianceTab; label: string }[] = [
    { key: "calendar", label: es ? "Calendario" : "Calendar" },
    { key: "filings", label: es ? "Radicaciones anuales" : "Annual filings" },
  ];
  return (
    <div data-testid="dashboard-compliance">
      <div role="tablist" aria-label={es ? "Cumplimiento" : "Compliance"} className="mb-4 inline-flex rounded-xl border border-[#D9DCE1] bg-[#F7F5EF] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`compliance-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`compliance-tabpanel-${t.key}`}
            onClick={() => onTab(t.key)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const next = tab === "calendar" ? "filings" : "calendar";
                onTab(next);
                window.setTimeout(() => document.getElementById(`compliance-tab-${next}`)?.focus(), 0);
              }
            }}
            tabIndex={tab === t.key ? 0 : -1}
            data-testid={`compliance-tab-${t.key}`}
            className={`min-h-11 rounded-lg px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === t.key ? "bg-white text-brand shadow-sm" : "text-slate-600 hover:text-[#161616]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="compliance-tabpanel-calendar" aria-labelledby="compliance-tab-calendar" hidden={tab !== "calendar"}>
        <ComplianceCalendarView
          embedded
          data={data}
          lang={lang}
          lockedBusinessId={businessIds}
          onShowFilings={() => onTab("filings")}
          onOpenItem={(item) => onOpenObligation(item.id)}
        />
      </div>
      <div role="tabpanel" id="compliance-tabpanel-filings" aria-labelledby="compliance-tab-filings" hidden={tab !== "filings"}>
        <AnnualFilingsView
          embedded
          data={data as FilingsPortfolio | null /* same /api/portfolio payload */}
          lang={lang}
          lockedBusinessId={businessIds}
          onShowCalendar={() => onTab("calendar")}
          onOpenItem={(item) => onOpenObligation(item.id)}
        />
      </div>
    </div>
  );
}
