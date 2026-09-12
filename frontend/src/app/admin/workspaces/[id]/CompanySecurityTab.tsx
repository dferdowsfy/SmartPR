"use client";

import { useCallback, useEffect, useState } from "react";

interface SecurityData {
  sso: {
    enabled: boolean;
    domain: string | null;
    provider_id: string | null;
    verified_at: string | null;
    last_successful_login: string | null;
    enforcement: string | null;
  } | null;
  domain: {
    custom_domain: string | null;
    verification: {
      domain: string;
      status: string;
      tls_status: string | null;
      last_attempt_at: string | null;
      last_error: string | null;
    } | null;
  };
  support_access: {
    active: Array<{ id: string; granted_to_email: string; reason: string; scope: string; expires_at: string }>;
    recent: Array<{ id: string; granted_to_email: string; reason: string; scope: string; expires_at: string; revoked_at: string | null; created_at: string }>;
  };
  security_events: Array<{
    id: string;
    created_at: string;
    action: string;
    actor_email: string | null;
    source: string | null;
    reason: string | null;
  }>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-48 shrink-0 text-[#5a5a5a]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const SECURITY_ACTIONS = [
  "support_access.granted",
  "support_access.revoked",
  "feature_flag.updated",
  "team.member_removed",
  "roles.granted",
  "roles.revoked",
];

export function CompanySecurityTab({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [ovRes, auRes] = await Promise.all([
        fetch(`/api/admin/workspaces/${workspaceId}/overview`),
        fetch(
          `/api/admin/workspaces/${workspaceId}/audit?${new URLSearchParams({ page_size: "100" }).toString()}`
        ),
      ]);
      const ov = await ovRes.json();
      if (!ovRes.ok) throw new Error(ov.error || "Could not load security data.");
      const au = auRes.ok ? await auRes.json() : { events: [] };
      const security_events = (au.events || []).filter((e: { action: string }) =>
        SECURITY_ACTIONS.some((a) => e.action === a || e.action.startsWith("sso.") || e.action.startsWith("domain."))
      );
      setData({
        sso: ov.sso,
        domain: ov.domain,
        support_access: {
          active: ov.support_access.active,
          recent: ov.support_access.recent,
        },
        security_events,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="py-6 text-sm text-[#5a5a5a]">Loading security…</p>;
  if (err) return <p className="py-6 text-sm text-red-700">{err}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">SSO posture</h3>
        <dl className="mt-2">
          <Row label="Status">
            {data.sso?.enabled ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">enabled</span>
            ) : (
              <span className="rounded-full bg-[#161616]/8 px-2 py-0.5 text-xs">disabled</span>
            )}
          </Row>
          <Row label="Domain">{data.sso?.domain || "—"}</Row>
          <Row label="Provider">{data.sso?.provider_id || "—"}</Row>
          <Row label="Verified at">{data.sso?.verified_at ? new Date(data.sso.verified_at).toLocaleString() : "not verified"}</Row>
          <Row label="Enforcement">{data.sso?.enforcement || "not enforced"}</Row>
          <Row label="Last successful SSO login">
            {data.sso?.last_successful_login ? new Date(data.sso.last_successful_login).toLocaleString() : "—"}
          </Row>
        </dl>
        {data.sso?.enabled && !data.sso?.verified_at && (
          <p className="mt-2 text-xs text-amber-700">
            Warning: SSO is enabled but the connection was never verified.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Domain verification</h3>
        <dl className="mt-2">
          <Row label="Custom domain">{data.domain.custom_domain || "—"}</Row>
          <Row label="Status">
            {data.domain.verification ? (
              <span className="rounded-full bg-[#161616]/8 px-2 py-0.5 text-xs font-medium">
                {data.domain.verification.status}
              </span>
            ) : (
              "no verification record"
            )}
          </Row>
          <Row label="TLS">{data.domain.verification?.tls_status || "—"}</Row>
          <Row label="Last attempt">
            {data.domain.verification?.last_attempt_at
              ? new Date(data.domain.verification.last_attempt_at).toLocaleString()
              : "—"}
          </Row>
          {data.domain.verification?.last_error && (
            <Row label="Last error">
              <span className="text-red-700">{data.domain.verification.last_error}</span>
            </Row>
          )}
        </dl>
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Support access</h3>
        {data.support_access.active.length === 0 ? (
          <p className="mt-2 text-sm text-[#5a5a5a]">No active support grants.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.support_access.active.map((g) => (
              <li key={g.id} className="rounded-lg border border-amber-600/30 bg-amber-50 px-3 py-2 text-sm">
                <span className="font-medium">{g.granted_to_email}</span>
                <span className="text-[#5a5a5a]"> · {g.scope} · expires {new Date(g.expires_at).toLocaleString()}</span>
                <div className="text-xs text-[#5a5a5a]">Reason: {g.reason}</div>
              </li>
            ))}
          </ul>
        )}
        {data.support_access.recent.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[#5a5a5a]">Recent grants</p>
            <table className="mt-1 w-full text-left text-xs">
              <tbody>
                {data.support_access.recent.map((g) => (
                  <tr key={g.id} className="border-b border-[#161616]/8">
                    <td className="py-1.5 pr-2">{g.granted_to_email}</td>
                    <td className="py-1.5 pr-2 text-[#5a5a5a]">{g.scope}</td>
                    <td className="py-1.5 pr-2 text-[#5a5a5a]">
                      {g.revoked_at ? (
                        <span className="text-red-700">revoked</span>
                      ) : new Date(g.expires_at) > new Date() ? (
                        <span className="text-green-700">active</span>
                      ) : (
                        "expired"
                      )}
                    </td>
                    <td className="py-1.5 text-[#5a5a5a]">{new Date(g.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Recent security events</h3>
        {data.security_events.length === 0 ? (
          <p className="mt-2 text-sm text-[#5a5a5a]">No security-relevant events in the recent window.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <tbody>
              {data.security_events.slice(0, 20).map((e) => (
                <tr key={e.id} className="border-b border-[#161616]/8">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-[#5a5a5a]">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{e.action}</td>
                  <td className="py-1.5 pr-3 text-xs">{e.actor_email || "—"}</td>
                  <td className="max-w-[280px] truncate py-1.5 text-xs text-[#5a5a5a]">
                    {e.reason || e.source || "—"}
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
