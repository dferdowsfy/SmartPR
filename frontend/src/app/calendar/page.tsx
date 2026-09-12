"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { TopNav } from "../history/ui";
import { StatusBadge } from "../components/compliance/StatusBadge";
import { L } from "../i18n";
import { useLang } from "../useLang";
import type { ObligationStatus } from "../compliance/types";

interface EventItem {
  id: string;
  business_id: string;
  business_public_id: string | null;
  business_name: string;
  name: string;
  agency: string | null;
  due_date: string | null;
  status: ObligationStatus;
  matter_title: string | null;
}

interface Portfolio {
  businesses?: { id: string; legal_name: string }[];
  items?: EventItem[];
}

const HORIZONS = [7, 30, 60, 90, 365] as const;
type Horizon = (typeof HORIZONS)[number] | "all";

function CalendarContent() {
  const searchParams = useSearchParams();
  const lang = useLang();
  const es = lang === "es";
  const [data, setData] = useState<Portfolio | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("all");
  const [business, setBusiness] = useState(() => searchParams.get("business") || "");
  useEffect(() => {
    fetch("/api/portfolio").then((response) => response.json()).then(setData).catch(() => setData({}));
  }, []);
  const events = useMemo(() => {
    const today = new Date();
    return (data?.items ?? []).filter((item) => {
      if (!item.due_date || item.status === "COMPLETED") return false;
      // Accept either the UUID or the short public id (?business= can carry either).
      if (business && item.business_id !== business && item.business_public_id !== business) return false;
      if (horizon === "all") return true;
      const days = Math.ceil((new Date(`${item.due_date}T23:59:59`).getTime() - today.getTime()) / 86400000);
      return days <= horizon;
    }).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  }, [data, horizon, business]);

  // How many items fall inside each horizon, so the pills carry a count
  // instead of just a label — same business filter as the list below.
  const horizonCounts = useMemo(() => {
    const today = new Date();
    const withinBusiness = (data?.items ?? []).filter((item) => {
      if (!item.due_date || item.status === "COMPLETED") return false;
      // Accept either the UUID or the short public id (?business= can carry either).
      if (business && item.business_id !== business && item.business_public_id !== business) return false;
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
  }, [data, business]);
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
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="calendar" />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">{L("Due dates", lang)}</p><h1 className="mt-1 text-3xl font-bold text-[#161616]">{L("Compliance calendar", lang)}</h1><p className="mt-1 text-sm text-slate-500">{L("Portfolio-level deadlines linked to the relevant business and obligation.", lang)}</p></div>
          <select value={business} onChange={(event) => setBusiness(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-[#161616]"><option value="">{L("All businesses", lang)}</option>{data?.businesses?.map((item) => <option key={item.id} value={item.id}>{item.legal_name}</option>)}</select>
        </div>
        <div className="mt-3 text-sm">
          <Link href="/filings" className="font-semibold text-brand hover:underline">{L("View annual filings →", lang)}</Link>
          <span className="ml-2 text-slate-400">{L("yearly renewals like Informe Anual and Patente, in one place.", lang)}</span>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">{[...HORIZONS.map((days) => ({ key: days as Horizon })), { key: "all" as Horizon }].map(({ key }) => {
          const active = horizon === key;
          const count = horizonCounts.get(key) ?? 0;
          return (
            <button key={key} onClick={() => setHorizon(key)} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-[#161616] text-white" : "border border-slate-300 bg-white text-slate-600"}`}>
              <span>{horizonLabel(key)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
            </button>
          );
        })}</div>
        <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
          <span><span className="font-bold text-[#161616] tabular-nums">{events.length}</span> {es ? `vencimiento${events.length === 1 ? "" : "s"} en este horizonte` : `item${events.length === 1 ? "" : "s"} in this horizon`}</span>
          {overdueCount > 0 && <span className="flex items-center gap-1.5 font-semibold text-red-700"><span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold tabular-nums">{overdueCount}</span> {L("overdue", lang)}</span>}
        </div>
        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {data === null ? <div className="py-14 text-center text-slate-500">{L("Loading calendar…", lang)}</div> : events.length === 0 ? <div className="py-14 text-center"><CalendarDays className="mx-auto mb-3 h-9 w-9 text-slate-300" /><div className="font-semibold text-[#161616]">{L("No due dates in this horizon.", lang)}</div><p className="mt-1 text-sm text-slate-500">{L("Dates stay unset until documentation or a sourced date is provided.", lang)}</p></div> : <div className="divide-y divide-slate-100">{events.map((item) => {
            const date = new Date(`${item.due_date}T00:00:00`);
            return <Link key={item.id} href={`/businesses/${item.business_public_id || item.business_id}#obligation-${item.id}`} className="grid gap-3 px-5 py-4 hover:bg-[#f4f1ea] sm:grid-cols-[80px_1fr_auto] sm:items-center"><div className="rounded-xl bg-slate-100 py-2 text-center"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{date.toLocaleDateString(es ? "es-PR" : "en-US", { month: "short" })}</div><div className="text-xl font-extrabold text-[#161616]">{date.getDate()}</div></div><div><div className="font-bold text-[#161616]">{item.name}</div><div className="text-xs text-slate-500">{item.business_name} · {item.agency || L("Agency not recorded", lang)}{item.matter_title ? ` · ${item.matter_title}` : ""}</div></div><StatusBadge status={item.status} lang={lang} /></Link>;
          })}</div>}
        </section>
      </main>
    </div>
  );
}

function CalendarFallback() {
  const lang = useLang();
  return <div className="min-h-screen bg-[#f4f1ea]"><TopNav active="calendar" /><div className="p-12 text-center text-slate-500">{L("Loading calendar…", lang)}</div></div>;
}

export default function CalendarPage() {
  return <Suspense fallback={<CalendarFallback />}><CalendarContent /></Suspense>;
}
