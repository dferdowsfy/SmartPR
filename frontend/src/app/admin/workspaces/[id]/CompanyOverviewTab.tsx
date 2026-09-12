"use client";

import { useCallback, useEffect, useState } from "react";

interface OverviewData {
  workspace: { id: string; name: string; created_at: string };
  subscription: { plan: string; status: string; current_period_end: string | null; owner_email: string | null } | null;
  entitlements: Record<string, unknown>;
  contract: { start: string | null; renewal: string | null; billing_contact: string | null; smartpr_owner: string | null };
  counts: { users: number; businesses: number; facilities: number; active_projects: number; projects_total: number };
  storage: { bytes: number; display: string; files: number };
  readiness: { avg_score: number | null; scored_projects: number };
  overdue_obligations: number;
  sso: { enabled: boolean; domain: string | null; provider_id: string | null; verified_at: string | null; last_successful_login: string | null; enforcement: string | null } | null;
  domain: { custom_domain: string | null; verification: { domain: string; status: string; tls_status: string | null; last_attempt_at: string | null; last_error: string | null } | null };
  support_access: { active: Array<{ id: string; granted_to_email: string; reason: string; scope: string; expires_at: string }>; recent: unknown[] };
  last_login: string | null;
  recent_activity: Array<{ id: string; created_at: string; action: string; target_type: string | null; source: string | null; actor_email: string | null }>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-4">
      <div className="text-xs uppercase tracking-wide text-[#5a5a5a]">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[#5a5a5a]">{sub}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-44 shrink-0 text-[#5a5a5a]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function CompanyOverviewTab({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/overview`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load overview.");
      setData(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="py-6 text-sm text-[#5a5a5a]">Loading overview…</p>;
  if (err) return <p className="py-6 text-sm text-red-700">{err}</p>;
  if (!data) return null;

  const storageLimit = Number(data.entitlements.storage_limit_bytes ?? 0);
  const storagePct =
    storageLimit > 0 ? Math.min(100, Math.round((data.storage.bytes / storageLimit) * 100)) : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={String(data.counts.users)} />
        <Stat label="Businesses" value={String(data.counts.businesses)} />
        <Stat label="Facilities" value={String(data.counts.facilities)} />
        <Stat label="Active projects" value={String(data.counts.active_projects)} sub={`${data.counts.projects_total} total`} />
        <Stat
          label="Readiness (avg)"
          value={data.readiness.avg_score != null ? `${Math.round(data.readiness.avg_score)}%` : "—"}
          sub={`${data.readiness.scored_projects} scored projects`}
        />
        <Stat label="Overdue obligations" value={String(data.overdue_obligations)} />
        <Stat label="Evidence storage" value={data.storage.display} sub={`${data.storage.files} files${storagePct != null ? ` · ${storagePct}% of limit` : ""}`} />
        <Stat label="Support access" value={String(data.support_access.active.length)} sub={data.support_access.active.length > 0 ? "active grant(s)" : "none active"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
          <h3 className="font-semibold">Plan & contract</h3>
          <dl className="mt-2">
            <Row label="Plan">{data.subscription?.plan ?? "—"} <span className="text-[#5a5a5a]">({data.subscription?.status ?? "no subscription row"})</span></Row>
            <Row label="Current period ends">{data.subscription?.current_period_end ? new Date(data.subscription.current_period_end).toLocaleDateString() : "—"}</Row>
            <Row label="Contract start">{data.contract.start || "—"}</Row>
            <Row label="Contract renewal">{data.contract.renewal || "—"}</Row>
            <Row label="Billing contact">{data.contract.billing_contact || data.subscription?.owner_email || "—"}</Row>
            <Row label="SmartPR owner">{data.contract.smartpr_owner || "—"}</Row>
            <Row label="Workspace created">{new Date(data.workspace.created_at).toLocaleDateString()}</Row>
            <Row label="Last login (any member)">{data.last_login ? new Date(data.last_login).toLocaleString() : "—"}</Row>
          </dl>
        </div>

        <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
          <h3 className="font-semibold">SSO & domain</h3>
          <dl className="mt-2">
            <Row label="SSO">
              {data.sso?.enabled ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">enabled</span>
              ) : (
                <span className="text-[#5a5a5a]">disabled</span>
              )}
            </Row>
            <Row label="SSO domain">{data.sso?.domain || "—"}</Row>
            <Row label="SSO verified">{data.sso?.verified_at ? new Date(data.sso.verified_at).toLocaleString() : "—"}</Row>
            <Row label="SSO enforcement">{data.sso?.enforcement || "—"}</Row>
            <Row label="Last SSO login">{data.sso?.last_successful_login ? new Date(data.sso.last_successful_login).toLocaleString() : "—"}</Row>
            <Row label="Custom domain">{data.domain.custom_domain || "—"}</Row>
            <Row label="Domain verification">
              {data.domain.verification ? (
                <>
                  <span className="font-mono text-xs">{data.domain.verification.domain}</span>{" "}
                  <span className="rounded-full bg-[#161616]/8 px-2 py-0.5 text-xs">{data.domain.verification.status}</span>
                  {data.domain.verification.last_error && (
                    <span className="text-xs text-red-700"> · {data.domain.verification.last_error}</span>
                  )}
                </>
              ) : (
                "—"
              )}
            </Row>
          </dl>
        </div>
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Recent activity</h3>
        {data.recent_activity.length === 0 ? (
          <p className="mt-2 text-sm text-[#5a5a5a]">No audit events recorded for this workspace yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <tbody>
              {data.recent_activity.map((e) => (
                <tr key={e.id} className="border-b border-[#161616]/8">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-[#5a5a5a]">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{e.action}</td>
                  <td className="py-1.5 pr-3 text-xs">{e.actor_email || "—"}</td>
                  <td className="py-1.5 text-xs">
                    <span className="rounded-full bg-[#161616]/8 px-2 py-0.5">{e.source || "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
