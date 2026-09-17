"use client";

import { useCallback, useEffect, useState } from "react";
import { readJson } from "@/lib/safe-json";

type Dash = {
  disclaimer: string;
  controls: {
    total: number;
    by_status: Record<string, number>;
    disclaimer: string;
  };
  live: {
    evidence_records: number;
    open_incidents: number;
    open_risks: number;
    active_policies: number;
    access_reviews_90d: number;
    active_support_grants: number;
  };
  control_list: Array<{ id: string; name: string; status: string; category: string }>;
};

export function SecurityDashboardClient() {
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/security/dashboard");
      const body = await readJson<Dash>(res);
      if (!body.ok || !body.data) {
        setErr(body.error || `HTTP ${body.status}`);
        setData(null);
      } else {
        setData(body.data);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch lifecycle
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-[#5a5a5a]">Loading…</p>;
  if (err) return <p className="text-sm text-red-700">Error: {err}</p>;
  if (!data) return null;

  const by = data.controls.by_status;
  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        {data.disclaimer}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Controls inventoried" value={String(data.controls.total)} />
        <Stat label="Implemented (repo)" value={String(by.implemented ?? 0)} />
        <Stat label="Partial / verify" value={String((by.partial ?? 0) + (by.requires_verification ?? 0))} />
        <Stat label="Evidence records" value={String(data.live.evidence_records)} />
        <Stat label="Open incidents" value={String(data.live.open_incidents)} />
        <Stat label="Open risks" value={String(data.live.open_risks)} />
        <Stat label="Active policies" value={String(data.live.active_policies)} />
        <Stat label="Access reviews (90d)" value={String(data.live.access_reviews_90d)} />
        <Stat label="Active support grants" value={String(data.live.active_support_grants)} />
      </div>
      <div className="overflow-hidden rounded-xl border border-[#161616]/15 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#fbf8f2] text-xs uppercase tracking-wide text-[#5a5a5a]">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Control</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Category</th>
            </tr>
          </thead>
          <tbody>
            {data.control_list.map((c) => (
              <tr key={c.id} className="border-t border-[#161616]/10">
                <td className="px-4 py-2 font-mono text-xs">{c.id}</td>
                <td className="px-4 py-2">{c.name}</td>
                <td className="px-4 py-2">{c.status}</td>
                <td className="px-4 py-2 text-[#5a5a5a]">{c.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#161616]/15 bg-white p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-[#5a5a5a]">{label}</div>
    </div>
  );
}
