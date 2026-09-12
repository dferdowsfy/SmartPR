"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useEnterpriseWorkspaces } from "../../_lib/useEnterpriseWorkspaces";

const ENTERPRISE_ROLE_KEYS = [
  "org_owner", "org_admin", "compliance_executive", "compliance_manager",
  "facility_manager", "contributor", "evidence_reviewer", "auditor",
  "external_counsel", "billing_admin",
];
const SCOPES = ["organization", "business", "facility", "project"];

interface Assignment {
  id: string;
  user_id: string;
  email: string | null;
  role_key: string;
  role_label: string;
  scope_type: string;
  scope_id: string | null;
  scope_name: string | null;
  created_at: string;
}

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";
const btnDanger =
  "rounded-lg border border-red-700/40 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

function RolesInner() {
  const { workspaces, workspace, workspaceId } = useEnterpriseWorkspaces();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [gUserId, setGUserId] = useState("");
  const [gRole, setGRole] = useState("contributor");
  const [gScope, setGScope] = useState("organization");
  const [gScopeId, setGScopeId] = useState("");

  const qs = () => `workspace_id=${encodeURIComponent(workspaceId || "")}`;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/enterprise/admin/roles?${qs()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load assignments.");
      setAssignments(data.assignments || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  async function grant() {
    if (!gUserId.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/enterprise/admin/roles?${qs()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: gUserId.trim(),
          role_key: gRole,
          scope_type: gScope,
          scope_id: gScopeId.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Grant failed.");
      setMsg(data.duplicate ? "That assignment already exists." : "Role granted.");
      setGUserId("");
      setGScopeId("");
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(a: Assignment) {
    if (!confirm(`Revoke ${a.role_key} (${a.scope_type}) from ${a.email || a.user_id}?`)) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/enterprise/admin/roles?${qs()}&id=${encodeURIComponent(a.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revoke failed.");
      setMsg("Assignment revoked.");
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#5a5a5a]">
            Organization administration
          </p>
          <h1 className="mt-1 text-3xl font-bold">Roles & scopes</h1>
          {workspace && <p className="mt-1 text-sm text-[#5a5a5a]">{workspace.name}</p>}
        </div>
        <select
          className={inputCls}
          value={workspaceId ?? ""}
          onChange={(e) => {
            if (e.target.value)
              window.location.search = `?workspace=${encodeURIComponent(e.target.value)}`;
          }}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {err && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="mt-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{msg}</p>}

      <div className="mt-5 rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-4">
        <h2 className="text-sm font-semibold">Grant a role</h2>
        <p className="mt-1 text-xs text-[#5a5a5a]">
          The user must already be a member (invite them from the Team page first). Copy a
          user ID from the table below.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input className={inputCls} placeholder="User ID (uuid)" value={gUserId} onChange={(e) => setGUserId(e.target.value)} />
          <select className={inputCls} value={gRole} onChange={(e) => setGRole(e.target.value)}>
            {ENTERPRISE_ROLE_KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select className={inputCls} value={gScope} onChange={(e) => { setGScope(e.target.value); setGScopeId(""); }}>
            {SCOPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder={gScope === "organization" ? "—" : "Scope UUID"}
            value={gScopeId}
            disabled={gScope === "organization"}
            onChange={(e) => setGScopeId(e.target.value)}
          />
          <button className={btnPrimary} onClick={() => void grant()} disabled={busy || !gUserId.trim()}>
            Grant
          </button>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-[#5a5a5a]">Loading…</p>}
      {!loading && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#161616]/15 text-xs uppercase tracking-wide text-[#5a5a5a]">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Granted</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} className="border-b border-[#161616]/8">
                  <td className="px-4 py-2.5">
                    <div className="text-xs font-medium">{a.email || "—"}</div>
                    <div className="font-mono text-[11px] text-[#5a5a5a]">{a.user_id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium">{a.role_label || a.role_key}</td>
                  <td className="px-4 py-2.5 text-xs text-[#5a5a5a]">
                    {a.scope_type === "organization"
                      ? "Organization"
                      : `${a.scope_type}: ${a.scope_name || (a.scope_id || "").slice(0, 8)}`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#5a5a5a]">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className={btnDanger} onClick={() => void revoke(a)} disabled={busy}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#5a5a5a]">
                    No enterprise role assignments yet — members are covered by their legacy roles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-[#5a5a5a]">
        Coverage is hierarchical: organization ⊃ business ⊃ facility ⊃ project. A scope
        never crosses workspaces.
      </p>
    </div>
  );
}

export default function EnterpriseRolesPage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <Suspense fallback={<p className="px-6 py-8 text-sm">Loading…</p>}>
        <RolesInner />
      </Suspense>
    </div>
  );
}
