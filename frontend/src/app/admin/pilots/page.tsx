"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "../../history/ui";

type Member = {
  user_id: string;
  email: string | null;
  role: string;
  redeemed_at: string;
  assessments: number;
  forms_prepared: Array<{ form_code: string; count: number }>;
  uploads_validated: number;
  deliverables: number;
  last_active: string | null;
};

type Pilot = {
  code: string;
  workspace_name: string;
  plan: string;
  workspace_id: string | null;
  redemptions_used: number;
  max_redemptions: number;
  pilot_days: number;
  expires_at: string | null;
  active: boolean;
  members: Member[];
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AdminPilotsPage() {
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/pilots")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || j.error || "Failed to load");
        setPilots(j.pilots || []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] text-[#161616]">
      <TopNav active="admin" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium">Pilot activity</h1>
            <p className="mt-1 text-sm text-[#5a5a5a]">
              Who redeemed each partner code — and what they actually did: assessments, forms prepared, uploads, deliverables.
            </p>
          </div>
          <Link href="/admin/billing" className="text-sm font-medium text-brand underline-offset-4 hover:underline">
            Manage codes
          </Link>
        </div>

        {loading && <p className="text-sm text-[#5a5a5a]">Loading…</p>}
        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
        {!loading && !error && pilots.length === 0 && (
          <p className="text-sm text-[#5a5a5a]">No partner codes yet. Create one from <Link href="/admin/billing" className="underline">billing admin</Link>.</p>
        )}

        {pilots.map((p) => (
          <section key={p.code} className="mb-6 rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">{p.code}</h2>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{
                      background: p.active ? "#ecfdf5" : "#fef2f2",
                      color: p.active ? "#047857" : "#b91c1c",
                      border: `1px solid ${p.active ? "#a7f3d0" : "#fecaca"}`,
                    }}
                  >
                    {p.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[#5a5a5a]">
                  {p.workspace_name} · plan <strong>{p.plan}</strong> · {p.redemptions_used}/{p.max_redemptions} redemptions
                  {p.expires_at ? ` · code expires ${fmtDate(p.expires_at)}` : ""}
                </p>
              </div>
            </div>

            {p.members.length === 0 ? (
              <p className="mt-4 text-sm text-[#5a5a5a]">No redemptions yet — share the signup link with the code.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#161616]/10 text-left text-xs uppercase tracking-wide text-[#5a5a5a]">
                      <th className="py-2 pr-4">User</th>
                      <th className="py-2 pr-4">Redeemed</th>
                      <th className="py-2 pr-4">Assessments</th>
                      <th className="py-2 pr-4">Forms prepared</th>
                      <th className="py-2 pr-4">Uploads</th>
                      <th className="py-2 pr-4">Deliverables</th>
                      <th className="py-2">Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.members.map((m) => (
                      <tr key={m.user_id} className="border-b border-[#161616]/5 align-top">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{m.email || m.user_id.slice(0, 8)}</div>
                          <div className="text-xs text-[#5a5a5a]">{m.role}</div>
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(m.redeemed_at)}</td>
                        <td className="py-2 pr-4">{m.assessments}</td>
                        <td className="py-2 pr-4">
                          {m.forms_prepared.length === 0 ? (
                            <span className="text-[#5a5a5a]">—</span>
                          ) : (
                            m.forms_prepared.map((f) => (
                              <div key={f.form_code} className="whitespace-nowrap">
                                <span className="font-mono text-xs font-semibold">{f.form_code}</span>
                                <span className="text-xs text-[#5a5a5a]"> ×{f.count}</span>
                              </div>
                            ))
                          )}
                        </td>
                        <td className="py-2 pr-4">{m.uploads_validated}</td>
                        <td className="py-2 pr-4">{m.deliverables}</td>
                        <td className="py-2 whitespace-nowrap">{fmtDate(m.last_active)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
