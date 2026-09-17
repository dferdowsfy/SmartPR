"use client";

import { useCallback, useEffect, useState } from "react";
import { readJson } from "@/lib/safe-json";

type Snapshot = {
  disclaimer: string;
  snapshot: {
    admin_allowlist: Array<{ email: string; groups?: string[] }>;
    active_support_grants: Array<Record<string, unknown>>;
    active_service_accounts: Array<Record<string, unknown>>;
  };
  past_reviews: Array<Record<string, unknown>>;
};

export function AccessReviewClient() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [findings, setFindings] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const res = await fetch("/api/admin/security/access-review");
    const body = await readJson<Snapshot>(res);
    if (!body.ok || !body.data) {
      setErr(body.error || `HTTP ${body.status}`);
      return;
    }
    setData(body.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch lifecycle
    void load();
  }, [load]);

  async function recordReview() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/security/access-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          period_start: periodStart,
          period_end: periodEnd,
          findings_summary: findings,
          status: "completed",
          snapshot: data?.snapshot ?? {},
        }),
      });
      const body = await readJson<{ review?: { id: string } }>(res);
      if (!body.ok) {
        setMsg(body.error || `HTTP ${body.status}`);
      } else {
        setMsg(`Review recorded: ${body.data?.review?.id ?? "ok"}`);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!data) return <p className="text-sm text-[#5a5a5a]">Loading…</p>;

  return (
    <div className="space-y-8">
      <p className="rounded-lg border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm">
        {data.disclaimer}
      </p>

      <Section title={`Admin allowlist (${data.snapshot.admin_allowlist.length})`}>
        <ul className="text-sm">
          {data.snapshot.admin_allowlist.length === 0 ? (
            <li className="text-[#5a5a5a]">
              Empty or unavailable — if production also has empty ADMIN_EMAILS, OPEN DEFAULT may
              apply. Requires verification.
            </li>
          ) : (
            data.snapshot.admin_allowlist.map((a) => (
              <li key={a.email} className="font-mono text-xs">
                {a.email}{" "}
                <span className="text-[#5a5a5a]">{(a.groups || []).join(", ")}</span>
              </li>
            ))
          )}
        </ul>
      </Section>

      <Section title={`Active support grants (${data.snapshot.active_support_grants.length})`}>
        <pre className="overflow-auto rounded bg-[#fbf8f2] p-3 text-xs">
          {JSON.stringify(data.snapshot.active_support_grants, null, 2)}
        </pre>
      </Section>

      <Section title={`Active service accounts (${data.snapshot.active_service_accounts.length})`}>
        <pre className="overflow-auto rounded bg-[#fbf8f2] p-3 text-xs">
          {JSON.stringify(data.snapshot.active_service_accounts, null, 2)}
        </pre>
      </Section>

      <Section title="Record a completed review">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Period start
            <input
              type="date"
              className="mt-1 w-full rounded border border-[#161616]/22 px-3 py-2"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Period end
            <input
              type="date"
              className="mt-1 w-full rounded border border-[#161616]/22 px-3 py-2"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </label>
        </div>
        <textarea
          className="mt-3 w-full rounded border border-[#161616]/22 px-3 py-2 text-sm"
          rows={3}
          placeholder="Findings summary (required for useful evidence)"
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !periodStart || !periodEnd}
          onClick={() => void recordReview()}
          className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50"
        >
          Record review
        </button>
        {msg && <p className="mt-2 text-sm">{msg}</p>}
      </Section>

      <Section title="Past reviews">
        <pre className="overflow-auto rounded bg-[#fbf8f2] p-3 text-xs">
          {JSON.stringify(data.past_reviews, null, 2)}
        </pre>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#161616]/15 bg-white p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
