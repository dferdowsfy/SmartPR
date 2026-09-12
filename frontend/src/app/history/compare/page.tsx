"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TopNav, ScorePill, NotConnected } from "../ui";

interface Side {
  id: string;
  municipality: string | null;
  business_type: string | null;
  business_structure: string | null;
  location_type: string | null;
  readiness_score: number | null;
  document_count: number;
  documents: string[] | null;
}
interface Comp {
  enabled: boolean;
  error?: string;
  a?: Side; b?: Side;
  onlyInA?: string[]; onlyInB?: string[]; shared?: string[];
}

function SideCard({ side, label }: { side: Side; label: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex-1">
      <div className="text-xs font-bold uppercase tracking-wide text-[#161616]/40 mb-2">{label}</div>
      <div className="space-y-1 text-sm">
        <div className="font-semibold text-[#161616]">{side.municipality || "—"}</div>
        <div className="text-[#161616]/80">{side.business_type || "—"}</div>
        <div className="text-[#161616]/60 text-xs">{side.business_structure || "—"} · {side.location_type || "—"}</div>
      </div>
      <div className="flex items-center gap-4 mt-4">
        <div>
          <div className="text-xs text-[#161616]/50">Readiness</div>
          <ScorePill score={side.readiness_score} />
        </div>
        <div>
          <div className="text-xs text-[#161616]/50">Documents</div>
          <div className="text-lg font-bold text-[#161616]">{side.document_count}</div>
        </div>
      </div>
      <Link href={`/history/${side.id}`} className="text-xs text-brand font-medium mt-3 inline-block">View details →</Link>
    </div>
  );
}

function CompareInner() {
  const sp = useSearchParams();
  const a = sp.get("a");
  const b = sp.get("b");
  const [c, setC] = useState<Comp | null>(null);

  useEffect(() => {
    if (!a || !b) return;
    fetch(`/api/history/compare?a=${a}&b=${b}`).then((r) => r.json()).then(setC).catch(() => setC({ enabled: true, error: "fetch" }));
  }, [a, b]);

  if (!c) return <div className="p-10 text-center text-[#161616]/50">Loading comparison…</div>;
  if (!c.enabled) return <NotConnected />;
  if (c.error || !c.a || !c.b) return <div className="p-10 text-center text-[#161616]/50">Could not load both submissions.</div>;

  const scoreDelta = (c.b.readiness_score ?? 0) - (c.a.readiness_score ?? 0);

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <Link href="/history" className="text-sm text-brand font-medium">← Back to History</Link>
      <h1 className="text-2xl font-bold text-[#161616] mt-2 mb-6">Compare Scenarios</h1>

      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        <SideCard side={c.a} label="Scenario A" />
        <div className="flex items-center justify-center text-[#161616]/40 font-bold">vs</div>
        <SideCard side={c.b} label="Scenario B" />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-5">
        <div className="font-bold text-[#161616] mb-3">Differences</div>
        <div className="text-sm mb-4">
          Readiness difference:{" "}
          <span className="font-bold" style={{ color: scoreDelta >= 0 ? "#10b981" : "#ef4444" }}>
            {scoreDelta >= 0 ? "+" : ""}{scoreDelta}%
          </span>{" "}
          (B vs A)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-2">Only in Scenario A ({c.onlyInA?.length || 0})</div>
            {c.onlyInA && c.onlyInA.length ? (
              <ul className="text-sm text-[#161616]/80 space-y-1">{c.onlyInA.map((x) => <li key={x}>• {x}</li>)}</ul>
            ) : <div className="text-xs text-[#161616]/40">None</div>}
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-brand mb-2">Only in Scenario B ({c.onlyInB?.length || 0})</div>
            {c.onlyInB && c.onlyInB.length ? (
              <ul className="text-sm text-[#161616]/80 space-y-1">{c.onlyInB.map((x) => <li key={x}>• {x}</li>)}</ul>
            ) : <div className="text-xs text-[#161616]/40">None</div>}
          </div>
        </div>
        <div className="text-xs text-[#161616]/50 mt-4">{c.shared?.length || 0} documents required in both scenarios.</div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="history" />
      <Suspense fallback={<div className="p-10 text-center text-[#161616]/50">Loading…</div>}>
        <CompareInner />
      </Suspense>
    </div>
  );
}
