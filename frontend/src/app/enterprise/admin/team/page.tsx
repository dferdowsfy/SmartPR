"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useEnterpriseWorkspaces } from "../../_lib/useEnterpriseWorkspaces";

const ENTERPRISE_ROLE_KEYS = [
  "org_owner", "org_admin", "compliance_executive", "compliance_manager",
  "facility_manager", "contributor", "evidence_reviewer", "auditor",
  "external_counsel", "billing_admin",
];
const LEGACY_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
const SCOPES = ["organization", "business", "facility", "project"];

interface Assignment {
  id: string;
  user_id: string;
  role_key: string;
  role_label: string;
  scope_type: string;
  scope_id: string | null;
  scope_name: string | null;
}
interface Member {
  user_id: string;
  email: string | null;
  full_name: string | null;
  legacy_role: string;
  joined_at: string;
}
interface Invite {
  id: string;
  email: string;
  legacy_role: string;
  enterprise_role_key: string | null;
  enterprise_role_scope_type: string | null;
  expires_at: string;
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

function scopeLabel(a: { scope_type: string; scope_id: string | null; scope_name?: string | null }) {
  if (a.scope_type === "organization") return "Organization";
  const name = a.scope_name || (a.scope_id || "").slice(0, 8);
  return `${a.scope_type}: ${name}`;
}

function TeamInner() {
  const { workspaces, workspace, workspaceId } = useEnterpriseWorkspaces();
  const [members, setMembers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // invite drawer
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("contributor");
  const [invLegacy, setInvLegacy] = useState("");
  const [invScope, setInvScope] = useState("organization");
  const [invScopeId, setInvScopeId] = useState("");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  // role editor (per member)
  const [editing, setEditing] = useState<Member | null>(null);
  const [editLegacy, setEditLegacy] = useState("");
  const [editAssignments, setEditAssignments] = useState<
    Array<{ role_key: string; scope_type: string; scope_id: string }>
  >([]);

  const qs = () => `workspace_id=${encodeURIComponent(workspaceId || "")}`;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/enterprise/admin/team?${qs()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load team.");
      setMembers(data.members || []);
      setAssignments(data.assignments || []);
      setInvites(data.invites || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  const assignmentsFor = (userId: string) => assignments.filter((a) => a.user_id === userId);

  async function sendInvite() {
    if (!invEmail.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/enterprise/admin/team?${qs()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: invEmail.trim(),
          enterprise_role: invRole,
          legacy_role: invLegacy || undefined,
          scope_type: invScope,
          scope_id: invScopeId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.code || "Invite failed.");
      setMsg(
        `Invite sent to ${data.invite.email}${data.invite.emailed ? "" : " (email not configured — share the link below)"}.`
      );
      setLastInviteUrl(data.invite.inviteUrl || null);
      setInvEmail("");
      setInvScopeId("");
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openEditor(m: Member) {
    setEditing(m);
    setEditLegacy(m.legacy_role);
    setEditAssignments(
      assignmentsFor(m.user_id).map((a) => ({
        role_key: a.role_key,
        scope_type: a.scope_type,
        scope_id: a.scope_type === "organization" ? "" : a.scope_id || "",
      }))
    );
    setMsg(null);
    setErr(null);
  }

  async function saveEditor() {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/enterprise/admin/team/${editing.user_id}?${qs()}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legacy_role: editLegacy,
          assignments: editAssignments.map((a) => ({
            role_key: a.role_key,
            scope_type: a.scope_type,
            scope_id: a.scope_id.trim() || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed.");
      setMsg("Member updated.");
      setEditing(null);
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(m: Member) {
    if (!confirm(`Remove ${m.email || m.user_id} from this organization?`)) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/enterprise/admin/team/${m.user_id}?${qs()}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Remove failed.");
      setMsg("Member removed.");
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
          <h1 className="mt-1 text-3xl font-bold">Team</h1>
          {workspace && (
            <p className="mt-1 text-sm text-[#5a5a5a]">{workspace.name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          <button className={btnPrimary} onClick={() => { setInviteOpen(true); setLastInviteUrl(null); }}>
            Invite member
          </button>
        </div>
      </div>

      {err && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="mt-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{msg}</p>}
      {loading && <p className="mt-4 text-sm text-[#5a5a5a]">Loading…</p>}

      {!loading && (
        <>
          <div className="mt-5 overflow-x-auto rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#161616]/15 text-xs uppercase tracking-wide text-[#5a5a5a]">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Legacy role</th>
                  <th className="px-4 py-3 font-medium">Enterprise roles</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} className="border-b border-[#161616]/8 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.email || m.user_id.slice(0, 8)}</div>
                      {m.full_name && <div className="text-xs text-[#5a5a5a]">{m.full_name}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[#161616]/8 px-2 py-0.5 text-xs font-medium">
                        {m.legacy_role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {assignmentsFor(m.user_id).length === 0 ? (
                        <span className="text-xs text-[#5a5a5a]">— (legacy role only)</span>
                      ) : (
                        <ul className="space-y-1">
                          {assignmentsFor(m.user_id).map((a) => (
                            <li key={a.id} className="text-xs">
                              <span className="font-medium">{a.role_label || a.role_key}</span>
                              <span className="text-[#5a5a5a]"> · {scopeLabel(a)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#5a5a5a]">
                      {new Date(m.joined_at).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button className={btnGhost} onClick={() => openEditor(m)} disabled={busy}>
                        Edit roles
                      </button>{" "}
                      <button className={btnDanger} onClick={() => void removeMember(m)} disabled={busy}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#5a5a5a]">
                      No members yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {invites.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold">Pending invites</h2>
              <div className="mt-2 overflow-x-auto rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
                <table className="w-full text-left text-sm">
                  <tbody>
                    {invites.map((i) => (
                      <tr key={i.id} className="border-b border-[#161616]/8">
                        <td className="px-4 py-2.5 font-medium">{i.email}</td>
                        <td className="px-4 py-2.5 text-xs text-[#5a5a5a]">
                          {i.legacy_role}
                          {i.enterprise_role_key ? ` · ${i.enterprise_role_key} (${i.enterprise_role_scope_type})` : ""}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-[#5a5a5a]">
                          expires {new Date(i.expires_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setInviteOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-[#fbf8f2] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Invite member</h2>
            <div className="mt-4 space-y-3">
              <input className={`${inputCls} w-full`} type="email" placeholder="Email address" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
              <div>
                <label className="text-xs text-[#5a5a5a]">Enterprise role</label>
                <select className={`${inputCls} mt-1 w-full`} value={invRole} onChange={(e) => setInvRole(e.target.value)}>
                  {ENTERPRISE_ROLE_KEYS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[#5a5a5a]">Legacy workspace role (optional — derived from enterprise role when blank)</label>
                <select className={`${inputCls} mt-1 w-full`} value={invLegacy} onChange={(e) => setInvLegacy(e.target.value)}>
                  <option value="">Auto</option>
                  {LEGACY_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-[#5a5a5a]">Scope</label>
                  <select className={`${inputCls} mt-1 w-full`} value={invScope} onChange={(e) => setInvScope(e.target.value)}>
                    {SCOPES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#5a5a5a]">Scope ID (UUID)</label>
                  <input
                    className={`${inputCls} mt-1 w-full`}
                    placeholder={invScope === "organization" ? "—" : "Business / facility / project ID"}
                    value={invScopeId}
                    onChange={(e) => setInvScopeId(e.target.value)}
                    disabled={invScope === "organization"}
                  />
                </div>
              </div>
              {lastInviteUrl && (
                <div className="rounded-lg bg-[#161616]/5 p-3 text-xs">
                  <p className="font-medium">Invite link (share manually if email isn&apos;t configured):</p>
                  <p className="mt-1 break-all font-mono">{lastInviteUrl}</p>
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setInviteOpen(false)}>Cancel</button>
              <button className={btnPrimary} onClick={() => void sendInvite()} disabled={busy || !invEmail.trim()}>
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-[#fbf8f2] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Edit roles — {editing.email || editing.user_id.slice(0, 8)}</h2>
            <div className="mt-4">
              <label className="text-xs text-[#5a5a5a]">Legacy workspace role</label>
              <select className={`${inputCls} mt-1 w-full`} value={editLegacy} onChange={(e) => setEditLegacy(e.target.value)}>
                {LEGACY_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#5a5a5a]">Enterprise role assignments (replaces all)</label>
                <button
                  className={btnGhost}
                  onClick={() => setEditAssignments([...editAssignments, { role_key: "contributor", scope_type: "organization", scope_id: "" }])}
                >
                  + Add
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {editAssignments.map((a, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                    <select className={inputCls} value={a.role_key} onChange={(e) => {
                      const next = [...editAssignments];
                      next[idx] = { ...a, role_key: e.target.value };
                      setEditAssignments(next);
                    }}>
                      {ENTERPRISE_ROLE_KEYS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                    <select className={inputCls} value={a.scope_type} onChange={(e) => {
                      const next = [...editAssignments];
                      next[idx] = { ...a, scope_type: e.target.value, scope_id: "" };
                      setEditAssignments(next);
                    }}>
                      {SCOPES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      className={inputCls}
                      placeholder={a.scope_type === "organization" ? "—" : "Scope UUID"}
                      value={a.scope_id}
                      disabled={a.scope_type === "organization"}
                      onChange={(e) => {
                        const next = [...editAssignments];
                        next[idx] = { ...a, scope_id: e.target.value };
                        setEditAssignments(next);
                      }}
                    />
                    <button
                      className={btnDanger}
                      onClick={() => setEditAssignments(editAssignments.filter((_, i) => i !== idx))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {editAssignments.length === 0 && (
                  <p className="text-xs text-[#5a5a5a]">No enterprise assignments — legacy role applies.</p>
                )}
              </div>
            </div>
            <p className="mt-4 text-xs text-[#5a5a5a]">
              The last organization owner cannot be removed or demoted — the server rejects it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
              <button className={btnPrimary} onClick={() => void saveEditor()} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EnterpriseTeamPage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <Suspense fallback={<p className="px-6 py-8 text-sm">Loading…</p>}>
        <TeamInner />
      </Suspense>
    </div>
  );
}
