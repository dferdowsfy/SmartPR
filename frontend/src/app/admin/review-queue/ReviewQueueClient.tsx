"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReviewQueue } from "../../locations/siteCases/reviewQueue";
import { LABEL_TEXT, READINESS_CRITERIA, type ReadinessLabel } from "../../locations/siteCases/readiness";

const PILL: Record<ReadinessLabel, string> = {
  needs_professional_review: "bg-amber-100 text-amber-900",
  ready_for_internal_screening: "bg-sky-100 text-sky-900",
  ready_for_client_delivery: "bg-emerald-100 text-emerald-900",
};

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "unknown");

export function ReviewQueueClient() {
  const [data, setData] = useState<ReviewQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/review-queue", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ReviewQueue);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/review-queue", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<ReviewQueue>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void load()} className="rounded-md border border-[#161616]/20 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50">
          {busy ? "Loading…" : "Refresh"}
        </button>
        {error && <span className="text-sm text-red-700">Couldn&apos;t load: {error}</span>}
      </div>

      {data?.status === "missing" && (
        <p className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-6 text-sm">
          No map-data check has been stored on this server yet. The scheduled read-only check (<code>npm run geo:drift</code>) writes its result to <code>{data.path}</code>, and it will show up here.
        </p>
      )}
      {data?.status === "invalid" && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm">
          The stored check at <code>{data.path}</code> couldn&apos;t be read ({data.reason}). Engineering should rerun <code>npm run geo:drift</code>.
        </p>
      )}
      {data?.status === "ok" && (
        <>
          <p className="text-sm text-[#5a5a5a]">
            Last checked {when(data.checked_at)} across {data.cases.length} sample location{data.cases.length === 1 ? "" : "s"}.{" "}
            {data.total === 0 ? "Every official answer matched the record, so there is nothing to review." : `${data.total} item${data.total === 1 ? "" : "s"} to review.`}
            {data.dropped > 0 && ` ${data.dropped} malformed item${data.dropped === 1 ? " was" : "s were"} skipped.`}
          </p>
          {data.groups.map((g) => (
            <section key={g.route}>
              <h2 className="text-lg font-semibold">{g.title} ({g.items.length})</h2>
              <p className="mb-3 text-sm text-[#5a5a5a]">{g.help}</p>
              <ul className="space-y-3">
                {g.items.map((i, n) => (
                  <li key={`${i.case_id}:${n}`} className="rounded-xl border border-[#161616]/15 bg-white p-4 text-sm">
                    <div className="font-medium">{i.case_label}</div>
                    <p className="mt-1">{i.what_changed}</p>
                    <p className="mt-2"><span className="font-medium">Reports that may be affected:</span> {i.affects}</p>
                    <p className="mt-1">
                      <span className="font-medium">Official evidence:</span> {i.evidence.source}. Recorded &ldquo;{i.evidence.recorded}&rdquo; on {when(i.evidence.recorded_at)}; live check gave &ldquo;{i.evidence.live}&rdquo; on {when(i.evidence.checked_at)}.
                    </p>
                    <p className="mt-1"><span className="font-medium">Recommended action:</span> {i.recommended_action}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {data.readiness.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold">Case readiness ({data.readiness.length})</h2>
              <ul className="mb-3 space-y-1 text-sm text-[#5a5a5a]">
                {(Object.keys(READINESS_CRITERIA) as ReadinessLabel[]).map((l) => (
                  <li key={l}><span className="font-medium text-[#161616]">{LABEL_TEXT[l]}:</span> {READINESS_CRITERIA[l]}</li>
                ))}
              </ul>
              <ul className="space-y-3">
                {data.readiness.map((r) => (
                  <li key={r.case_id} className="rounded-xl border border-[#161616]/15 bg-white p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.case_label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL[r.label]}`}>{LABEL_TEXT[r.label]}</span>
                    </div>
                    {r.gaps.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {r.gaps.map((g) => <li key={g.id}>{g.explanation}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
