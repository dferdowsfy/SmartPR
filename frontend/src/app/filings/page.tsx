"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileCheck2 } from "lucide-react";
import { TopNav } from "../history/ui";
import { StatusBadge } from "../components/compliance/StatusBadge";
import {
  countFilings,
  filingYear,
  groupAnnualFilings,
  type FilingLike,
} from "../compliance/annualFilings";

interface Portfolio {
  businesses?: { id: string; legal_name: string }[];
  items?: FilingLike[];
}

function FilingsContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<Portfolio | null>(null);
  const [business, setBusiness] = useState(() => searchParams.get("business") || "");
  useEffect(() => {
    fetch("/api/portfolio").then((response) => response.json()).then(setData).catch(() => setData({}));
  }, []);

  const filings = useMemo(() => {
    const items = (data?.items ?? []).filter((item) => !business || item.business_id === business);
    return items;
  }, [data, business]);

  const counts = useMemo(() => countFilings(filings), [filings]);
  const groups = useMemo(() => groupAnnualFilings(filings), [filings]);

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="filings" />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#245c5c]">Recurring compliance</p>
            <h1 className="mt-1 text-3xl font-bold text-[#161616]">Annual filings</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Every yearly filing for every business — Informe Anual, Patente, CRIM — in one place.
              SmartPR reminds you 90, 60, 30 and 7 days out, and queues next year&apos;s filing the moment you complete this one.
            </p>
          </div>
          <select value={business} onChange={(event) => setBusiness(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-[#161616]" aria-label="Filter by business">
            <option value="">All businesses</option>
            {data?.businesses?.map((item) => <option key={item.id} value={item.id}>{item.legal_name}</option>)}
          </select>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { label: "Overdue", value: counts.overdue, tone: "text-red-700 bg-red-50 border-red-200" },
            { label: "Due soon", value: counts.dueSoon, tone: "text-amber-800 bg-amber-50 border-amber-200" },
            { label: "Upcoming", value: counts.upcoming, tone: "text-slate-600 bg-white border-slate-200" },
            { label: "Filed", value: counts.filed, tone: "text-emerald-800 bg-emerald-50 border-emerald-200" },
          ].map((chip) => (
            <span key={chip.label} className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${chip.tone}`}>
              {chip.label}
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold tabular-nums">{chip.value}</span>
            </span>
          ))}
        </div>

        <div className="mt-4 text-sm text-slate-500">
          <span><span className="font-bold text-[#161616] tabular-nums">{counts.total}</span> annual filing{counts.total === 1 ? "" : "s"} tracked</span>
          <span className="mx-2 text-slate-300">·</span>
          <Link href="/calendar" className="font-semibold text-[#245c5c] hover:underline">View full compliance calendar →</Link>
        </div>

        {data === null ? (
          <div className="py-14 text-center text-slate-500">Loading filings…</div>
        ) : groups.length === 0 ? (
          <div className="py-14 text-center">
            <FileCheck2 className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <div className="font-semibold text-[#161616]">No annual filings tracked yet.</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Annual filings appear here once your businesses have obligations with a yearly renewal —
              for example the Informe Anual or the municipal Patente.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {groups.map((group) => (
              <section key={group.business_id}>
                <h2 className="text-lg font-bold text-[#161616]">{group.business_name}</h2>
                <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {group.filings.map((filing) => {
                    const filed = filing.status === "COMPLETED";
                    const year = filingYear(filing.due_date);
                    return (
                      <Link
                        key={filing.id}
                        href={`/businesses/${filing.business_id}#obligation-${filing.id}`}
                        className={`grid gap-3 px-5 py-4 hover:bg-[#f4f1ea] sm:grid-cols-[80px_1fr_auto] sm:items-center ${filed ? "opacity-60" : ""}`}
                      >
                        <div className="rounded-xl bg-slate-100 py-2 text-center">
                          {filing.due_date ? (
                            <>
                              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                {new Date(`${filing.due_date}T00:00:00`).toLocaleDateString("en-US", { month: "short" })}
                              </div>
                              <div className="text-xl font-extrabold text-[#161616]">{new Date(`${filing.due_date}T00:00:00`).getDate()}</div>
                            </>
                          ) : (
                            <div className="py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">No date</div>
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-[#161616]">
                            {filing.name}
                            {year && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{year}</span>}
                          </div>
                          <div className="text-xs text-slate-500">{filing.agency || "Agency not recorded"} · renews every year</div>
                        </div>
                        <StatusBadge status={filing.status} />
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function FilingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f4f1ea]"><TopNav active="filings" /><div className="p-12 text-center text-slate-500">Loading filings…</div></div>}>
      <FilingsContent />
    </Suspense>
  );
}
