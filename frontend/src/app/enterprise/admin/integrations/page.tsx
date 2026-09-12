// Phase 6 — Enterprise integrations UI.
// /enterprise/admin/integrations — signed webhooks (create, disable, rotate
// signing secrets, delivery history with retries, CSV export) and scoped
// service accounts (create, rotate, revoke). Raw secrets/credentials are
// shown exactly once at creation/rotation.

"use client";

import { useCallback, useEffect, useState } from "react";

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";
const cardCls = "rounded-xl border border-[#161616]/15 bg-white p-5";

const EVENT_LABELS: Record<string, string> = {
  "requirement.assigned": "Requirement assigned",
  "requirement.status_changed": "Requirement status changed",
  "evidence.submitted": "Evidence submitted",
  "evidence.approved": "Evidence approved",
  "evidence.rejected": "Evidence rejected",
  "deadline.approaching": "Deadline approaching",
  "requirement.overdue": "Requirement overdue",
  "regulatory.change_affecting_project": "Regulatory change affecting project",
  "readiness.score_changed": "Readiness score changed",
};

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret_configured: boolean;
  secret_fingerprint: string | null;
  deliveries_7d: number;
  failed_7d: number;
  created_at: string;
}
interface Delivery {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  next_retry_at: string | null;
  response_status: number | null;
  signature: string | null;
  created_at: string;
}
interface ServiceAccount {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  expired: boolean;
  last_used_at: string | null;
  revoked: boolean;
  credential_fingerprint: string | null;
}

const SCOPES = ["scim", "webhooks:read", "reports:read", "work:read", "work:write"];

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function SecretOnce({ value, kind }: { value: string; kind: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        This {kind} is shown once — copy it now.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs">{value}</code>
        <button
          className={btnGhost}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [allEvents, setAllEvents] = useState<string[]>([]);

  // webhook create form
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [onceSecret, setOnceSecret] = useState<string | null>(null);

  // deliveries viewer
  const [selectedEp, setSelectedEp] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveryStatus, setDeliveryStatus] = useState("");

  // service account create form
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<string[]>(["scim"]);
  const [newExpiry, setNewExpiry] = useState("");
  const [onceCredential, setOnceCredential] = useState<string | null>(null);

  const qs = useCallback(() => `workspace=${workspaceId}`, [workspaceId]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setErr(null);
    try {
      const [wRes, sRes] = await Promise.all([
        fetch(`/api/enterprise/integrations/webhooks?${qs()}`),
        fetch(`/api/enterprise/integrations/service-accounts?${qs()}`),
      ]);
      const w = await wRes.json();
      const s = await sRes.json();
      if (!wRes.ok) throw new Error(w.error || "failed to load webhooks");
      if (!sRes.ok) throw new Error(s.error || "failed to load service accounts");
      setEndpoints(w.endpoints || []);
      setAllEvents(w.events || []);
      setAccounts(s.accounts || []);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [workspaceId, qs]);

  const loadDeliveries = useCallback(
    async (endpointId: string, status: string) => {
      if (!workspaceId) return;
      const params = new URLSearchParams({ workspace: workspaceId, limit: "50" });
      if (status) params.set("status", status);
      const res = await fetch(
        `/api/enterprise/integrations/webhooks/${endpointId}/deliveries?${params}`
      );
      const data = await res.json();
      if (res.ok) setDeliveries(data.deliveries || []);
    },
    [workspaceId]
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me");
        const data = await res.json();
        const ws = data?.user?.workspace_id as string | null;
        const role = data?.user?.workspace_role as string | null;
        if (!ws || (role !== "OWNER" && role !== "ADMIN")) {
          setDenied(true);
          setLoading(false);
          return;
        }
        setWorkspaceId(ws);
        setLoading(false);
      } catch {
        setDenied(true);
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (workspaceId) void load();
  }, [workspaceId, load]);

  useEffect(() => {
    if (selectedEp) void loadDeliveries(selectedEp, deliveryStatus);
  }, [selectedEp, deliveryStatus, loadDeliveries]);

  const createWebhook = async () => {
    setErr(null);
    setMsg(null);
    setOnceSecret(null);
    try {
      const res = await fetch(`/api/enterprise/integrations/webhooks?${qs()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: newUrl.trim(), events: newEvents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "create failed");
      setOnceSecret(data.secret);
      setNewUrl("");
      setNewEvents([]);
      setMsg("Webhook endpoint created.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const disableWebhook = async (id: string) => {
    if (!confirm("Disable this webhook endpoint? Deliveries stop immediately.")) return;
    setErr(null);
    const res = await fetch(`/api/enterprise/integrations/webhooks/${id}?${qs()}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setErr(data.error || "disable failed");
    else {
      setMsg("Webhook disabled.");
      await load();
    }
  };

  const rotateWebhook = async (id: string) => {
    if (!confirm("Rotate this endpoint's signing secret? The old secret stops working immediately.")) return;
    setErr(null);
    setOnceSecret(null);
    const res = await fetch(`/api/enterprise/integrations/webhooks/${id}/rotate?${qs()}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) setErr(data.detail || data.error || "rotation failed");
    else {
      setOnceSecret(data.secret);
      setMsg("Secret rotated.");
      await load();
    }
  };

  const createAccount = async () => {
    setErr(null);
    setMsg(null);
    setOnceCredential(null);
    try {
      const res = await fetch(`/api/enterprise/integrations/service-accounts?${qs()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          scopes: newScopes,
          expires_at: newExpiry ? new Date(newExpiry).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setOnceCredential(data.credential);
      setNewName("");
      setNewScopes(["scim"]);
      setNewExpiry("");
      setMsg("Service account created.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const rotateAccount = async (id: string) => {
    if (!confirm("Rotate this credential? The old credential stops working immediately.")) return;
    setErr(null);
    setOnceCredential(null);
    const res = await fetch(`/api/enterprise/integrations/service-accounts/${id}/rotate?${qs()}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) setErr(data.error || "rotation failed");
    else {
      setOnceCredential(data.credential);
      setMsg("Credential rotated.");
      await load();
    }
  };

  const revokeAccount = async (id: string) => {
    if (!confirm("Revoke this service account? This is immediate and irreversible.")) return;
    setErr(null);
    const res = await fetch(`/api/enterprise/integrations/service-accounts/${id}/revoke?${qs()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "revoked from integrations console" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setErr(data.error || "revoke failed");
    else {
      setMsg("Service account revoked.");
      await load();
    }
  };

  const toggleEvent = (list: string[], e: string, set: (v: string[]) => void) =>
    set(list.includes(e) ? list.filter((x) => x !== e) : [...list, e]);

  if (loading) return <main className="p-8 text-sm text-[#5a5a5a]">Loading integrations…</main>;
  if (denied)
    return (
      <main className="p-8">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="mt-2 text-sm text-[#5a5a5a]">
          You need an organization owner or administrator role to view this page.
        </p>
      </main>
    );

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Integrations</h1>
          <p className="mt-1 text-sm text-[#5a5a5a]">
            Signed webhooks and scoped service accounts (SCIM, API access).
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <a href="/enterprise/admin/security" className="rounded-lg px-3 py-1.5 hover:bg-[#161616]/5">
            Security
          </a>
          <span className="rounded-lg bg-[#161616]/8 px-3 py-1.5 font-medium">Integrations</span>
        </nav>
      </header>

      {err && <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>}
      {msg && <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{msg}</div>}
      {onceSecret && <SecretOnce value={onceSecret} kind="signing secret" />}
      {onceCredential && <SecretOnce value={onceCredential} kind="credential" />}

      {/* Webhooks */}
      <section className={cardCls}>
        <h2 className="text-lg font-semibold">Webhooks</h2>
        <p className="mt-1 text-xs text-[#5a5a5a]">
          JSON payloads signed with HMAC-SHA256 (<span className="font-mono">x-smartpr-signature</span>).
          Endpoints with non-HTTPS or test hostnames are recorded as <em>skipped</em> and never called.
        </p>

        <div className="mt-4 space-y-3">
          {endpoints.map((ep) => (
            <div key={ep.id} className="rounded-lg border border-[#161616]/12 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm">{ep.url}</p>
                  <p className="mt-1 text-xs text-[#5a5a5a]">
                    {ep.events.map((e) => EVENT_LABELS[e] || e).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-[#5a5a5a]">
                    <span className={`mr-2 rounded px-1.5 py-0.5 ${ep.active ? "bg-green-100 text-green-800" : "bg-[#161616]/8 text-[#5a5a5a]"}`}>
                      {ep.active ? "active" : "disabled"}
                    </span>
                    secret {ep.secret_configured ? `configured (${ep.secret_fingerprint})` : "missing"} ·{" "}
                    {ep.deliveries_7d} deliveries / {ep.failed_7d} failed (7d)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className={btnGhost} onClick={() => setSelectedEp(selectedEp === ep.id ? null : ep.id)}>
                    {selectedEp === ep.id ? "Hide deliveries" : "Deliveries"}
                  </button>
                  {ep.active && (
                    <button className={btnGhost} onClick={() => rotateWebhook(ep.id)}>
                      Rotate secret
                    </button>
                  )}
                  {ep.active && (
                    <button className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50" onClick={() => disableWebhook(ep.id)}>
                      Disable
                    </button>
                  )}
                </div>
              </div>

              {selectedEp === ep.id && (
                <div className="mt-3 border-t border-[#161616]/10 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select className={inputCls} value={deliveryStatus} onChange={(e) => setDeliveryStatus(e.target.value)}>
                      <option value="">All statuses</option>
                      {["pending", "delivered", "failed", "skipped", "disabled"].map((st) => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                    <button className={btnGhost} onClick={() => loadDeliveries(ep.id, deliveryStatus)}>
                      Refresh
                    </button>
                    <a
                      className="rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium hover:bg-[#161616]/5"
                      href={`/api/enterprise/integrations/webhooks/${ep.id}/deliveries?workspace=${workspaceId}${deliveryStatus ? `&status=${deliveryStatus}` : ""}&format=csv`}
                    >
                      Export CSV
                    </a>
                    <p className="text-xs text-[#5a5a5a]">CSV export downloads the current filter.</p>
                  </div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[#5a5a5a]">
                          <th className="py-1 pr-3">Event</th>
                          <th className="py-1 pr-3">Status</th>
                          <th className="py-1 pr-3">Attempts</th>
                          <th className="py-1 pr-3">Retry at</th>
                          <th className="py-1 pr-3">HTTP</th>
                          <th className="py-1 pr-3">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveries.map((d) => (
                          <tr key={d.id} className="border-t border-[#161616]/8">
                            <td className="py-1 pr-3 font-mono">{d.event_type}</td>
                            <td className="py-1 pr-3">
                              <span className={`rounded px-1.5 py-0.5 ${d.status === "delivered" ? "bg-green-100 text-green-800" : d.status === "failed" ? "bg-red-100 text-red-800" : "bg-[#161616]/8 text-[#5a5a5a]"}`}>
                                {d.status}
                              </span>
                            </td>
                            <td className="py-1 pr-3">{d.attempts}</td>
                            <td className="py-1 pr-3">{fmtDate(d.next_retry_at)}</td>
                            <td className="py-1 pr-3">{d.response_status ?? "—"}</td>
                            <td className="py-1 pr-3">{fmtDate(d.created_at)}</td>
                          </tr>
                        ))}
                        {deliveries.length === 0 && (
                          <tr><td colSpan={6} className="py-3 text-[#5a5a5a]">No deliveries yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
          {endpoints.length === 0 && (
            <p className="text-sm text-[#5a5a5a]">No webhook endpoints yet.</p>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-[#161616]/12 bg-[#fbf8f2] p-4">
          <h3 className="text-sm font-semibold">New webhook endpoint</h3>
          <div className="mt-2 flex flex-col gap-3">
            <input className={inputCls} placeholder="https://events.example-corp.com/smartpr" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {allEvents.map((e) => (
                <label key={e} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${newEvents.includes(e) ? "border-brand bg-brand/10" : "border-[#161616]/22"}`}>
                  <input type="checkbox" className="mr-1.5" checked={newEvents.includes(e)} onChange={() => toggleEvent(newEvents, e, setNewEvents)} />
                  {EVENT_LABELS[e] || e}
                </label>
              ))}
            </div>
            <div>
              <button className={btnPrimary} disabled={!newUrl.trim() || newEvents.length === 0} onClick={createWebhook}>
                Create endpoint
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Service accounts */}
      <section className={cardCls}>
        <h2 className="text-lg font-semibold">Service accounts</h2>
        <p className="mt-1 text-xs text-[#5a5a5a]">
          Scoped API identities. Only credential hashes are stored; the raw credential is shown once.
          Expiry is enforced at authentication time.
        </p>

        <div className="mt-4 space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[#161616]/12 p-4">
              <div>
                <p className="text-sm font-medium">
                  {a.name}
                  {a.revoked && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">revoked</span>}
                  {a.expired && !a.revoked && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">expired</span>}
                </p>
                <p className="mt-1 text-xs text-[#5a5a5a]">
                  scopes: {a.scopes.join(", ")} · fingerprint {a.credential_fingerprint || "—"}
                </p>
                <p className="text-xs text-[#5a5a5a]">
                  expires {fmtDate(a.expires_at)} · last used {fmtDate(a.last_used_at)}
                </p>
              </div>
              {!a.revoked && (
                <div className="flex gap-2">
                  <button className={btnGhost} onClick={() => rotateAccount(a.id)}>Rotate</button>
                  <button className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50" onClick={() => revokeAccount(a.id)}>
                    Revoke
                  </button>
                </div>
              )}
            </div>
          ))}
          {accounts.length === 0 && <p className="text-sm text-[#5a5a5a]">No service accounts yet.</p>}
        </div>

        <div className="mt-4 rounded-lg border border-[#161616]/12 bg-[#fbf8f2] p-4">
          <h3 className="text-sm font-semibold">New service account</h3>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input className={inputCls} placeholder="Account name (e.g. SCIM provisioner)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className={inputCls} type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} aria-label="Expiry date (optional)" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {SCOPES.map((sc) => (
              <label key={sc} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${newScopes.includes(sc) ? "border-brand bg-brand/10" : "border-[#161616]/22"}`}>
                <input type="checkbox" className="mr-1.5" checked={newScopes.includes(sc)} onChange={() => toggleEvent(newScopes, sc, setNewScopes)} />
                <span className="font-mono">{sc}</span>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <button className={btnPrimary} disabled={!newName.trim() || newScopes.length === 0} onClick={createAccount}>
              Create account
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
