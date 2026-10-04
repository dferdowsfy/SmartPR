"use client";

import { useCallback, useEffect, useState } from "react";
import type { EndpointHealth } from "../../locations/layerService";
import type { HealthReport } from "../../locations/geoHealth";

type Data = { endpoints: EndpointHealth[]; report: HealthReport | null };

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "—");

export function GeoHealthClient() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (probe: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/geo-health${probe ? "?probe=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as Data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/geo-health", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Data>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void load(true)} className="rounded-md border border-[#161616]/20 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50">
          {busy ? "Checking…" : "Run live check"}
        </button>
        {error && <span className="text-sm text-red-700">Couldn&apos;t load: {error}</span>}
      </div>

      {data?.report && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">
            Live check — {data.report.ok ? "healthy" : "unhealthy"} ({data.report.required_failures} required / {data.report.optional_failures} optional failures)
          </h2>
          <table className="w-full text-left text-sm">
            <thead><tr><th className="py-1">Result</th><th>Check</th><th>Detail</th><th>ms</th></tr></thead>
            <tbody>
              {data.report.checks.map((c) => (
                <tr key={`${c.kind}:${c.id}`} className="border-t border-[#161616]/10 align-top">
                  <td className="py-1 pr-2">{c.ok ? "ok" : c.required ? "FAIL" : "warn"}</td>
                  <td className="pr-2 break-all">{c.id}</td>
                  <td className="pr-2 break-all">{c.detail}</td>
                  <td>{c.latency_ms ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">This instance (live traffic)</h2>
        {!data ? (
          <p className="text-sm text-[#5a5a5a]">Loading…</p>
        ) : data.endpoints.length === 0 ? (
          <p className="text-sm text-[#5a5a5a]">No map queries since this instance started.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead><tr><th className="py-1">Endpoint</th><th>OK</th><th>Failed</th><th>In a row</th><th>Last failure</th><th>Last OK</th><th>ms</th></tr></thead>
            <tbody>
              {data.endpoints.map((h) => (
                <tr key={h.url} className="border-t border-[#161616]/10 align-top">
                  <td className="py-1 pr-2 break-all">{h.url}</td>
                  <td>{h.ok}</td>
                  <td>{h.failed}</td>
                  <td>{h.consecutiveFailures >= 3 ? `${h.consecutiveFailures} (circuit open)` : h.consecutiveFailures}</td>
                  <td className="pr-2 break-all">{h.lastFailure ? `${h.lastFailure} · ${when(h.lastFailureAt)}` : "—"}</td>
                  <td>{when(h.lastOkAt)}</td>
                  <td>{h.lastLatencyMs ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
