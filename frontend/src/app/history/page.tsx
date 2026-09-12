"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopNav, fmtDate, statusLabel, ScorePill, NotConnected } from "./ui";

interface Row {
  id: string;
  created_at: string;
  municipality: string | null;
  business_type: string | null;
  business_structure: string | null;
  location_type: string | null;
  readiness_score: number | null;
  readiness_status: string | null;
  document_count: number;
}

export default function HistoryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((d) => { setEnabled(d.enabled); setRows(d.submissions || []); })
      .catch(() => { setRows([]); });
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id]));

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="history" />
      <div className="max-w-6xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-[#161616]">Submission History</h1>
          {selected.length === 2 && (
            <button
              onClick={() => router.push(`/history/compare?a=${selected[0]}&b=${selected[1]}`)}
              className="bg-brand text-white rounded-full px-5 py-2 text-sm font-medium"
            >
              Compare 2 scenarios →
            </button>
          )}
        </div>
        <p className="text-[#161616]/60 text-sm mb-6">
          Your compliance workspace — revisit prior assessments, compare scenarios, and resume unfinished work.
          {selected.length === 1 && <span className="text-brand font-medium"> Select one more to compare.</span>}
        </p>

        {!enabled && <NotConnected />}

        {enabled && rows && rows.length === 0 && (
          <div className="text-center text-[#161616]/50 py-16 border border-dashed rounded-2xl">
            No submissions yet. Complete a readiness assessment and it will appear here.
          </div>
        )}

        {enabled && rows && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className={`bg-white border rounded-2xl px-5 py-4 flex items-center gap-4 ${selected.includes(r.id) ? "border-brand ring-1 ring-brand/30" : "border-slate-200"}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={() => toggle(r.id)}
                  className="w-4 h-4 flex-shrink-0"
                  title="Select to compare"
                />
                <Link href={`/history/${r.id}`} className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
                  <div>
                    <div className="text-xs text-[#161616]/50">Date</div>
                    <div className="text-sm font-medium text-[#161616]">{fmtDate(r.created_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#161616]/50">Municipality</div>
                    <div className="text-sm font-medium text-[#161616]">{r.municipality || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#161616]/50">Business Type</div>
                    <div className="text-sm font-medium text-[#161616]">{r.business_type || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#161616]/50">Structure</div>
                    <div className="text-sm font-medium text-[#161616]">{r.business_structure || "—"}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <ScorePill score={r.readiness_score} />
                    <span className="text-xs text-[#161616]/70">{statusLabel(r.readiness_score, r.readiness_status)}</span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
