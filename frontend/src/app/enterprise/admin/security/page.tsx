// Phase 6 — Enterprise security center UI.
// /enterprise/admin/security — SSO status, connection test, enforcement,
// session/MFA policies, auto-provisioning, group->role mappings, and the
// documented emergency-recovery path. Server APIs enforce authorization;
// this page gates on the legacy workspace role for UX only.

"use client";

import { useCallback, useEffect, useState } from "react";

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";
const cardCls = "rounded-xl border border-[#161616]/15 bg-white p-5";

const ENTERPRISE_ROLES = [
  "org_owner",
  "org_admin",
  "compliance_executive",
  "compliance_manager",
  "facility_manager",
  "contributor",
  "evidence_reviewer",
  "auditor",
  "external_counsel",
  "billing_admin",
];
const MFA_POLICIES = ["optional", "required", "disabled"];

interface Check {
  check: string;
  passed: boolean;
  detail: string;
}
interface SsoTest {
  success: boolean;
  checked_at: string;
  details: { checks?: Check[] };
}
interface Posture {
  workspace_id: string;
  sso: {
    enabled: boolean;
    domain: string | null;
    provider_id: string | null;
    verified_at: string | null;
    verification_fresh: boolean;
    last_successful_login: string | null;
    enforcement: "disabled" | "enabled";
    test: SsoTest | null;
  };
  policies: {
    session_minutes: number;
    mfa_policy: string;
    auto_provision: boolean;
    default_role: string;
  };
  group_mappings: Array<{ group: string; role: string }>;
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function SecurityPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [posture, setPosture] = useState<Posture | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // editable policy fields
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoDomain, setSsoDomain] = useState("");
  const [ssoProviderId, setSsoProviderId] = useState("");
  const [sessionMinutes, setSessionMinutes] = useState(480);
  const [mfaPolicy, setMfaPolicy] = useState("optional");
  const [autoProvision, setAutoProvision] = useState(false);
  const [defaultRole, setDefaultRole] = useState("contributor");
  const [mappings, setMappings] = useState<Array<{ group: string; role: string }>>([]);
  const [testResult, setTestResult] = useState<{ success: boolean; checks: Check[] } | null>(null);

  const load = useCallback(async (ws: string) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/enterprise/security?workspace=${ws}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to load security posture");
      const p: Posture = data.posture;
      setPosture(p);
      setSsoEnabled(p.sso.enabled);
      setSsoDomain(p.sso.domain || "");
      setSsoProviderId(p.sso.provider_id || "");
      setSessionMinutes(p.policies.session_minutes);
      setMfaPolicy(p.policies.mfa_policy);
      setAutoProvision(p.policies.auto_provision);
      setDefaultRole(p.policies.default_role);
      setMappings(p.group_mappings);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me");
        const data = await res.json();
        const ws = data?.user?.workspace_id as string | null;
        const role = data?.user?.workspace_role as string | null;
        if (!ws) {
          setDenied(true);
          setLoading(false);
          return;
        }
        // UX gate only — the API enforces the real permission check.
        if (role !== "OWNER" && role !== "ADMIN") {
          setDenied(true);
          setLoading(false);
          return;
        }
        setWorkspaceId(ws);
        await load(ws);
      } catch {
        setDenied(true);
        setLoading(false);
      }
    })();
  }, [load]);

  const save = async () => {
    if (!workspaceId) return;
    setBusy("save");
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/enterprise/security?workspace=${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sso_enabled: ssoEnabled,
          sso_domain: ssoDomain.trim() ? ssoDomain.trim() : null,
          sso_provider_id: ssoProviderId.trim() ? ssoProviderId.trim() : null,
          session_minutes: Number(sessionMinutes),
          mfa_policy: mfaPolicy,
          auto_provision: autoProvision,
          sso_default_role: defaultRole,
          sso_group_mappings: mappings,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setMsg(
        data.verification_reset
          ? "Saved. The IdP connection changed, so prior verification was reset — run the connection test."
          : "Saved."
      );
      await load(workspaceId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    if (!workspaceId) return;
    setBusy("test");
    setErr(null);
    setMsg(null);
    setTestResult(null);
    try {
      const res = await fetch(`/api/enterprise/security/test-sso?workspace=${workspaceId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "test failed");
      setTestResult({ success: data.success, checks: data.checks || [] });
      await load(workspaceId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleEnforcement = async (enforce: boolean) => {
    if (!workspaceId) return;
    setBusy("enforce");
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/enterprise/security/enforcement?workspace=${workspaceId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enforce }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "failed");
      setMsg(enforce ? "SSO enforcement enabled." : "SSO enforcement disabled.");
      await load(workspaceId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <main className="p-8 text-sm text-[#5a5a5a]">Loading security center…</main>;
  if (denied)
    return (
      <main className="p-8">
        <h1 className="text-xl font-semibold">Security center</h1>
        <p className="mt-2 text-sm text-[#5a5a5a]">
          You need an organization owner or administrator role to view this page.
        </p>
      </main>
    );

  const s = posture?.sso;
  const enforcementBlocked = !posture?.sso.verification_fresh;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Security center</h1>
          <p className="mt-1 text-sm text-[#5a5a5a]">
            Identity, SSO, and session policy for this organization.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <span className="rounded-lg bg-[#161616]/8 px-3 py-1.5 font-medium">Security</span>
          <a href="/enterprise/admin/integrations" className="rounded-lg px-3 py-1.5 hover:bg-[#161616]/5">
            Integrations
          </a>
        </nav>
      </header>

      {err && <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>}
      {msg && <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{msg}</div>}

      {/* SSO status card */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Single sign-on (SSO)</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-6 sm:block">
                <dt className="text-[#5a5a5a]">Status</dt>
                <dd className="font-medium">{s?.enabled ? "Enabled" : "Disabled"}</dd>
              </div>
              <div className="flex justify-between gap-6 sm:block">
                <dt className="text-[#5a5a5a]">Verified domain</dt>
                <dd className="font-medium">{s?.domain || "—"}</dd>
              </div>
              <div className="flex justify-between gap-6 sm:block">
                <dt className="text-[#5a5a5a]">Provider id</dt>
                <dd className="font-mono text-xs">{s?.provider_id || "—"}</dd>
              </div>
              <div className="flex justify-between gap-6 sm:block">
                <dt className="text-[#5a5a5a]">Last verified</dt>
                <dd className="font-medium">
                  {fmtDate(s?.verified_at ?? null)}
                  {s?.verified_at && (
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${s.verification_fresh ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                      {s.verification_fresh ? "fresh" : "stale"}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-6 sm:block">
                <dt className="text-[#5a5a5a]">Last successful SSO login</dt>
                <dd className="font-medium">{fmtDate(s?.last_successful_login ?? null)}</dd>
              </div>
              <div className="flex justify-between gap-6 sm:block">
                <dt className="text-[#5a5a5a]">Enforcement</dt>
                <dd className="font-medium">{s?.enforcement === "enabled" ? "Enabled" : "Disabled"}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-col gap-2">
            <button className={btnPrimary} disabled={busy === "test"} onClick={runTest}>
              {busy === "test" ? "Testing…" : "Test SSO connection"}
            </button>
            <p className="max-w-[240px] text-xs text-[#5a5a5a]">
              Verifies the provider exists in Supabase Auth and the domain resolves via DNS.
            </p>
          </div>
        </div>

        {(testResult || s?.test) && (
          <div className="mt-4 rounded-lg border border-[#161616]/12 bg-[#fbf8f2] p-4">
            <p className="text-sm font-medium">
              Last test:{" "}
              <span className={(testResult?.success ?? s?.test?.success) ? "text-green-700" : "text-red-700"}>
                {(testResult?.success ?? s?.test?.success) ? "Passed" : "Failed"}
              </span>{" "}
              <span className="font-normal text-[#5a5a5a]">
                ({fmtDate(testResult ? new Date().toISOString() : (s?.test?.checked_at ?? null))})
              </span>
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {(testResult?.checks ?? s?.test?.details?.checks ?? []).map((c) => (
                <li key={c.check} className="flex gap-2">
                  <span className={c.passed ? "text-green-700" : "text-red-700"}>{c.passed ? "✓" : "✗"}</span>
                  <span>
                    <span className="font-mono text-xs">{c.check}</span> — {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Enforcement toggle — gated on a fresh successful test */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#161616]/12 p-4">
          <div>
            <p className="text-sm font-medium">Require SSO for all sign-ins</p>
            <p className="max-w-md text-xs text-[#5a5a5a]">
              {enforcementBlocked
                ? "Unavailable until the SSO connection test passes (verification is fresh for 30 days)."
                : "When enabled, password sign-in is disabled for this organization's domain."}
            </p>
          </div>
          <button
            className={s?.enforcement === "enabled" ? btnGhost : btnPrimary}
            disabled={busy === "enforce" || (enforcementBlocked && s?.enforcement !== "enabled")}
            onClick={() => toggleEnforcement(s?.enforcement !== "enabled")}
          >
            {busy === "enforce" ? "…" : s?.enforcement === "enabled" ? "Disable enforcement" : "Enable enforcement"}
          </button>
        </div>
      </section>

      {/* SSO config + policies */}
      <section className={cardCls}>
        <h2 className="text-lg font-semibold">SSO configuration</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ssoEnabled} onChange={(e) => setSsoEnabled(e.target.checked)} />
            SSO enabled
          </label>
          <div />
          <label className="block text-sm">
            <span className="text-[#5a5a5a]">SSO domain</span>
            <input className={`${inputCls} mt-1 w-full`} value={ssoDomain} onChange={(e) => setSsoDomain(e.target.value)} placeholder="company.com" />
          </label>
          <label className="block text-sm">
            <span className="text-[#5a5a5a]">SSO provider id (UUID from Supabase Auth)</span>
            <input className={`${inputCls} mt-1 w-full font-mono`} value={ssoProviderId} onChange={(e) => setSsoProviderId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </label>
        </div>
      </section>

      <section className={cardCls}>
        <h2 className="text-lg font-semibold">Session & access policies</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-[#5a5a5a]">Session duration (minutes, 5–1440)</span>
            <input type="number" min={5} max={1440} className={`${inputCls} mt-1 w-full`} value={sessionMinutes} onChange={(e) => setSessionMinutes(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="text-[#5a5a5a]">MFA policy</span>
            <select className={`${inputCls} mt-1 w-full`} value={mfaPolicy} onChange={(e) => setMfaPolicy(e.target.value)}>
              {MFA_POLICIES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} />
            Auto-provision users on first SSO sign-in
          </label>
          <label className="block text-sm">
            <span className="text-[#5a5a5a]">Default role for provisioned users</span>
            <select className={`${inputCls} mt-1 w-full`} value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
              {ENTERPRISE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className={cardCls}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Group → role mappings</h2>
          <button
            className={btnGhost}
            onClick={() => setMappings([...mappings, { group: "", role: "contributor" }])}
          >
            Add mapping
          </button>
        </div>
        <p className="mt-1 text-xs text-[#5a5a5a]">
          Map IdP/SCIM groups to SmartPR enterprise roles. Used by SCIM provisioning and SSO just-in-time role assignment.
        </p>
        <div className="mt-3 space-y-2">
          {mappings.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputCls} flex-1 min-w-[160px]`}
                placeholder="IdP group name (e.g. Finance)"
                value={m.group}
                onChange={(e) => {
                  const next = [...mappings];
                  next[i] = { ...next[i], group: e.target.value };
                  setMappings(next);
                }}
              />
              <span className="text-sm text-[#5a5a5a]">→</span>
              <select
                className={inputCls}
                value={m.role}
                onChange={(e) => {
                  const next = [...mappings];
                  next[i] = { ...next[i], role: e.target.value };
                  setMappings(next);
                }}
              >
                {ENTERPRISE_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                className="rounded-lg px-2 py-1 text-sm text-red-700 hover:bg-red-50"
                onClick={() => setMappings(mappings.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          {mappings.length === 0 && (
            <p className="text-sm text-[#5a5a5a]">No mappings yet — provisioned users get the default role.</p>
          )}
        </div>
      </section>

      <section className={cardCls}>
        <h2 className="text-lg font-semibold">Provisioning status</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-[#5a5a5a]">Auto-provisioning</dt><dd className="font-medium">{autoProvision ? "On" : "Off"}</dd></div>
          <div><dt className="text-[#5a5a5a]">Default role</dt><dd className="font-medium">{defaultRole}</dd></div>
          <div><dt className="text-[#5a5a5a]">Group mappings</dt><dd className="font-medium">{mappings.length}</dd></div>
          <div><dt className="text-[#5a5a5a]">SCIM endpoint</dt><dd className="font-mono text-xs">/api/scim/v2/Users · /api/scim/v2/Groups</dd></div>
        </dl>
      </section>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
        <h2 className="text-sm font-semibold text-amber-900">Emergency recovery</h2>
        <p className="mt-1 text-sm text-amber-900">
          If SSO enforcement locks everyone out (for example, the IdP certificate expired), a SmartPR
          superadmin can disable enforcement from the admin console:{" "}
          <span className="font-mono text-xs">PUT /api/admin/workspaces/{workspaceId}/branding</span>{" "}
          with <span className="font-mono text-xs">{`{"sso_enforcement": "disabled"}`}</span>. That path is
          superadmin-gated and written to the audit log — it is the documented recovery hatch, not a backdoor.
        </p>
      </section>

      <div className="flex justify-end">
        <button className={btnPrimary} disabled={busy === "save"} onClick={save}>
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>
      </div>
    </main>
  );
}
