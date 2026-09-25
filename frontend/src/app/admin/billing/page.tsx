"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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

type PartnerCodeRow = {
  id: string;
  code: string;
  plan: string;
  workspace_id: string | null;
  workspace_name: string;
  max_redemptions: number;
  redemption_count: number;
  pilot_days: number;
  expires_at: string | null;
  active: boolean;
};

export default function AdminBillingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [partnerCodes, setPartnerCodes] = useState<PartnerCodeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<(typeof PLANS)[number]>("enterprise");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newCodeName, setNewCodeName] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/billing", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || data.error || `Load failed (${res.status})`);
      return;
    }
    setRows(data.users || []);
  }, []);

  const loadCodes = useCallback(async () => {
    const res = await fetch("/api/admin/partner-codes", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setPartnerCodes(data.codes || []);
  }, []);

  useEffect(() => {
    void load();
    void loadCodes();
  }, [load, loadCodes]);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    setTempPassword(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          plan,
          status: "active",
          createIfMissing: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.error || `Grant failed (${res.status})`);
        return;
      }
      setMsg(data.message || `Granted ${data.plan} to ${data.email}`);
      if (data.temporaryPassword) {
        setTempPassword(String(data.temporaryPassword));
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function createPartnerCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/partner-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: newCode,
          plan: "partner",
          maxRedemptions: 10,
          pilotDays: 90,
          workspaceName: newCodeName || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.error || `Create code failed (${res.status})`);
        return;
      }
      setMsg(`Partner code ${data.code?.code || newCode} ready.`);
      setNewCode("");
      setNewCodeName("");
      await loadCodes();
    } finally {
      setCodeBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "calc(100dvh - var(--topnav-h, 64px))", background: "#f4f1ea", color: "#1a1a1a" }}>
      
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px" }}>
        <p style={{ marginBottom: 8 }}>
          <Link href="/admin/requirements">← Admin</Link>
        </p>
        <h1 style={{ fontFamily: "Newsreader, Georgia, serif", fontSize: 32, marginBottom: 8 }}>
          Billing &amp; plans
        </h1>
        <p style={{ marginBottom: 24, opacity: 0.8 }}>
          Grant a plan by email. If they don’t have an account yet, one is created and the temporary
          password is shown once below.
        </p>

        <form onSubmit={grant} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
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
              background: "var(--brand-primary)",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {busy ? "Saving…" : "Create / grant"}
          </button>
        </form>

        {error && (
          <p style={{ color: "#b00020", marginBottom: 12, fontWeight: 600 }}>{error}</p>
        )}
        {msg && <p style={{ color: "var(--brand-primary)", marginBottom: 12 }}>{msg}</p>}
        {tempPassword && (
          <div
            style={{
              marginBottom: 20,
              padding: 16,
              borderRadius: 12,
              background: "#fff8e6",
              border: "1px solid #e6c86a",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Temporary password (copy now)</div>
            <code style={{ fontSize: 20, letterSpacing: 1 }}>{tempPassword}</code>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              Send this to the user with their email. It is not stored in plain text and won’t appear
              again.
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 20, margin: "28px 0 8px" }}>Partner codes</h2>
        <p style={{ marginBottom: 12, opacity: 0.8, fontSize: 14 }}>
          Design-partner pilots share one workspace + plan. Share{" "}
          <code>/signup?code=LUYO-90</code>. Apply <code>data/partner_codes_schema.sql</code> once.
        </p>
        <form onSubmit={createPartnerCode} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            required
            placeholder="CODE-90"
            value={newCode}
            onChange={(ev) => setNewCode(ev.target.value.toUpperCase())}
            style={{ flex: "1 1 140px", padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
          />
          <input
            placeholder="Workspace name (optional)"
            value={newCodeName}
            onChange={(ev) => setNewCodeName(ev.target.value)}
            style={{ flex: "1 1 200px", padding: "10px 12px", borderRadius: 8, border: "1px solid #ccc" }}
          />
          <button
            type="submit"
            disabled={codeBusy}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: 0,
              background: "#245c5c",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {codeBusy ? "Saving…" : "Create partner code"}
          </button>
        </form>
        {partnerCodes.length > 0 && (
          <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid #e5e0d6", marginBottom: 28 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#faf8f4" }}>
                  <th style={{ padding: 12 }}>Code</th>
                  <th style={{ padding: 12 }}>Plan</th>
                  <th style={{ padding: 12 }}>Redemptions</th>
                  <th style={{ padding: 12 }}>Workspace</th>
                  <th style={{ padding: 12 }}>Expires</th>
                </tr>
              </thead>
              <tbody>
                {partnerCodes.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 12 }}><code>{c.code}</code></td>
                    <td style={{ padding: 12 }}>{c.plan}</td>
                    <td style={{ padding: 12 }}>{c.redemption_count}/{c.max_redemptions}</td>
                    <td style={{ padding: 12 }}>{c.workspace_name}</td>
                    <td style={{ padding: 12 }}>{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ fontSize: 20, margin: "8px 0 12px" }}>Users &amp; plans</h2>
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
