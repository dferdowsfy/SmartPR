"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { L } from "../i18n";
import { useLang } from "../useLang";
import { ComplianceCalendarView, type PortfolioData } from "../compliance/ComplianceCalendarView";

function CalendarContent() {
  const searchParams = useSearchParams();
  const lang = useLang();
  const [data, setData] = useState<PortfolioData | null>(null);
  useEffect(() => {
    fetch("/api/portfolio").then((response) => response.json()).then(setData).catch(() => setData({}));
  }, []);
  return (
    <div className="page-viewport bg-[#f4f1ea]">
      <main className="mx-auto max-w-5xl px-5 py-8">
        <ComplianceCalendarView data={data} lang={lang} initialBusiness={searchParams.get("business") || ""} />
      </main>
    </div>
  );
}

function CalendarFallback() {
  const lang = useLang();
  return <div className="page-viewport bg-[#f4f1ea]"><div className="p-12 text-center text-slate-500">{L("Loading calendar…", lang)}</div></div>;
}

export default function CalendarPage() {
  return <Suspense fallback={<CalendarFallback />}><CalendarContent /></Suspense>;
}
