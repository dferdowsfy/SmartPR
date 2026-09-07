"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "../../history/ui";

type Row = {
  user_id: string;
  email: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_kind: string | null;
  member_role: string | null;
  plan: string | null;
  subscription_status: string | null;
};

const PLANS = ["free", "core", "operator", "partner", "pilot", "enterprise"] as const;

export default function AdminBillingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<(typeof PLANS)[number]>("enterprise");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/billing", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "failed");
      return;
    }
    setRows(data.users || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, plan, status: "active" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "grant failed");
        return;
      }
      setMsg(`Granted ${data.plan} to ${data.email}`);
      setEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f1ea", color: "#1a1a1a" }}>
      <TopNav />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px" }}>
        <p style={{ marginBottom: 8 }}>
          <Link href="/admin/requirements">← Admin</Link>
        </p>
        <h1 style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 32, marginBottom: 8 }}>
          Billing &amp; plans
        </h1>
        <p style={{ marginBottom: 24, opacity: 0.8 }}>
          Grant complimentary plans by email (no Stripe charge). Admins are still controlled by{" "}
          <code>ADMIN_EMAILS</code> on Railway.
        </p>

        <form onSubmit={grant} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          <input
            type="email"
            required
            placeholder="user@email.com"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            style={{ flex: "1 1 220px", padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
          />
          <select
            value={plan}
            onChange={(ev) => setPlan(ev.target.value as (typeof PLANS)[number])}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: 0,
              background: "#245c5c",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {busy ? "Saving…" : "Grant plan"}
          </button>
        </form>

        {error && <p style={{ color: "#b00020", marginBottom: 12 }}>{error}</p>}
        {msg && <p style={{ color: "#245c5c", marginBottom: 12 }}>{msg}</p>}

        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid #e5e0d6" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#faf8f4" }}>
                <th style={{ padding: 12 }}>Email</th>
                <th style={{ padding: 12 }}>Workspace</th>
                <th style={{ padding: 12 }}>Plan</th>
                <th style={{ padding: 12 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.user_id}-${r.workspace_id || i}`} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 12 }}>{r.email || "—"}</td>
                  <td style={{ padding: 12 }}>
                    {r.workspace_name || "—"}
                    {r.member_role ? ` (${r.member_role})` : ""}
                  </td>
                  <td style={{ padding: 12 }}>{r.plan || "—"}</td>
                  <td style={{ padding: 12 }}>{r.subscription_status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
