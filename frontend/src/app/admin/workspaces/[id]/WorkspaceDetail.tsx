"use client";

import { useCallback, useEffect, useState } from "react";
import { CompanyOverviewTab } from "./CompanyOverviewTab";
import { CompanySecurityTab } from "./CompanySecurityTab";
import { CompanyPlanLimitsTab } from "./CompanyPlanLimitsTab";
import { CompanyFeatureFlagsTab } from "./CompanyFeatureFlagsTab";
import { CompanySupportAccessTab } from "./CompanySupportAccessTab";
import { CompanyAuditTab } from "./CompanyAuditTab";
import { BrandingDomainTab } from "./BrandingDomainTab";

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
const PLANS = ["free", "core", "operator", "partner", "pilot", "enterprise"] as const;
const TABS = ["Overview", "People & access", "Branding", "Branding & domain", "Security", "Plan", "Plan & limits", "Feature flags", "Support access", "Audit log"] as const;

interface Member {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  joined_at: string;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}
interface AuditEntry {
  id: string;
  actor_email: string;
  action: string;
  target_email: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";

export function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [branding, setBranding] = useState({
    company_name: "", logo_url: "", primary_color: "#245c5c",
    custom_domain: "", sso_enabled: false, sso_domain: "", sso_provider_id: "",
  });
  const [plan, setPlan] = useState("free");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [wsRes, teamRes, brandRes, auditRes] = await Promise.all([
        fetch(`/api/admin/workspaces/${workspaceId}`),
        fetch(`/api/admin/workspaces/${workspaceId}/team`),
        fetch(`/api/admin/workspaces/${workspaceId}/branding`),
        fetch(`/api/admin/audit-log?workspaceId=${workspaceId}&limit=50`),
      ]);
      const ws = await wsRes.json();
      if (!wsRes.ok) throw new Error(ws.error || "Could not load company.");
      setName(ws.workspace.name);
      setPlan(ws.workspace.plan || "free");
      const team = await teamRes.json();
      if (!teamRes.ok) throw new Error(team.error || "Could not load team.");
      setMembers(team.members || []);
      setInvites(team.invites || []);
      const br = await brandRes.json();
      if (brandRes.ok && br.branding) {
        setBranding({
          company_name: br.branding.company_name || "",
          logo_url: br.branding.logo_url || "",
          primary_color: br.branding.primary_color || "#245c5c",
          custom_domain: br.branding.custom_domain || "",
          sso_enabled: br.branding.sso_enabled === true,
          sso_domain: br.branding.sso_domain || "",
          sso_provider_id: br.branding.sso_provider_id || "",
        });
      }
      const au = await auditRes.json();
      if (auditRes.ok) setAudit(au.entries || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 4000);
  };

  const sendInvite = async () => {
    if (!inviteEmail.includes("@")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === "already_member"
        ? `Already on the team as ${data.role}.`
        : data.error || "Invite failed.");
      setInviteEmail("");
      setLastInviteUrl(data.invite.inviteUrl);
      flash(data.invite.emailed ? `Invitation sent to ${data.invite.email}.` : "Invite created — email not sent (SMTP not configured). Share the link below.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, role: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/team/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Role change failed.");
      flash("Role updated.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string, email: string | null) => {
    if (!window.confirm(`Remove ${email || "this member"} from the workspace?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/team/member`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Remove failed.");
      flash("Member removed.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resendInvite = async (inviteId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/invites/${inviteId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Resend failed.");
      setLastInviteUrl(data.inviteUrl);
      flash(data.emailed ? "Invitation resent." : "New link created — email not sent (SMTP not configured).");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (inviteId: string, email: string) => {
    if (!window.confirm(`Revoke the invitation for ${email}?`)) return;
    const res = await fetch(`/api/admin/invites/${inviteId}`, { method: "DELETE" });
    if (res.ok) {
      flash("Invitation revoked.");
      await load();
    } else {
      setErr("Revoke failed.");
    }
  };

  const saveBranding = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/branding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branding),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      flash("Branding saved.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Plan change failed.");
      flash(`Plan set to ${data.plan}.`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="mt-6 text-sm text-[#5a5a5a]">Loading…</p>;

  return (
    <div className="mt-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium">{name}</h1>

      {err && <div className="mt-4 rounded-lg border border-[#8a2f2f]/30 bg-[#8a2f2f]/8 px-4 py-3 text-sm text-[#8a2f2f]">{err}</div>}
      {msg && <div className="mt-4 rounded-lg border border-[#1f5a3a]/30 bg-[#1f5a3a]/8 px-4 py-3 text-sm text-[#1f5a3a]">{msg}</div>}

      <div className="mt-6 flex flex-wrap gap-1 border-b border-[#161616]/15">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium ${
              tab === t
                ? "border-b-2 border-brand text-[#161616]"
                : "text-[#5a5a5a] hover:text-[#161616]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="mt-6">
          <CompanyOverviewTab workspaceId={workspaceId} />
        </div>
      )}

      {tab === "People & access" && (
        <div className="mt-6">
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
            <h2 className="text-base font-semibold">Invite someone</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5a5a5a]">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className={`${inputCls} w-64`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5a5a5a]">Role</label>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className={inputCls}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>
              <button onClick={() => void sendInvite()} disabled={busy || !inviteEmail.includes("@")} className={btnPrimary}>
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
            {lastInviteUrl && (
              <div className="mt-3 rounded-lg bg-[#161616]/5 px-3 py-2 text-xs">
                <span className="font-medium">Invite link:</span>{" "}
                <span className="break-all text-brand">{lastInviteUrl}</span>
              </div>
            )}
          </div>

          {invites.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-base font-semibold">Pending invitations</h2>
              <div className="overflow-hidden rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
                {invites.map((i) => (
                  <div key={i.id} className="flex items-center justify-between border-b border-[#161616]/8 px-4 py-3 last:border-0">
                    <div>
                      <div className="text-sm font-medium">{i.email}</div>
                      <div className="text-xs text-[#5a5a5a]">
                        {i.role.toLowerCase()} · expires {new Date(i.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => void resendInvite(i.id)} disabled={busy} className="text-sm text-brand underline-offset-4 hover:underline disabled:opacity-50">
                        Resend
                      </button>
                      <button onClick={() => void revokeInvite(i.id, i.email)} className="text-sm text-[#8a2f2f] underline-offset-4 hover:underline">
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="mb-2 mt-8 text-base font-semibold">Members ({members.length})</h2>
          <div className="overflow-hidden rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#161616]/10 text-xs uppercase tracking-wide text-[#5a5a5a]">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} className="border-b border-[#161616]/8 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.full_name || m.email || m.user_id.slice(0, 8)}</div>
                      {m.full_name && <div className="text-xs text-[#5a5a5a]">{m.email}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={m.role}
                        onChange={(e) => void changeRole(m.user_id, e.target.value)}
                        disabled={busy}
                        className={`${inputCls} py-1.5`}
                        aria-label={`Role for ${m.email}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#5a5a5a]">
                      {new Date(m.joined_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => void removeMember(m.user_id, m.email)}
                        disabled={busy}
                        className="text-sm text-[#8a2f2f] underline-offset-4 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[#5a5a5a]">
            Owners outrank admins: admins can&apos;t change an owner&apos;s role, and a workspace always keeps at least one owner.
          </p>
        </div>
      )}

      {tab === "Branding" && (
        <div className="mt-6 max-w-lg rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
          <h2 className="text-base font-semibold">White-label branding</h2>
          <p className="mt-1 text-xs text-[#5a5a5a]">Shown to this company&apos;s users instead of SmartPR branding.</p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Company name</label>
              <input
                value={branding.company_name}
                onChange={(e) => setBranding({ ...branding, company_name: e.target.value })}
                placeholder="Acme Consulting"
                className={`${inputCls} w-full`}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Logo URL</label>
              <input
                value={branding.logo_url}
                onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })}
                placeholder="https://…"
                className={`${inputCls} w-full`}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Primary color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(branding.primary_color) ? branding.primary_color : "#245c5c"}
                  onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                  className="h-10 w-14 cursor-pointer rounded border border-[#161616]/22 bg-[#fbf8f2]"
                />
                <input
                  value={branding.primary_color}
                  onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                  placeholder="#245c5c"
                  className={`${inputCls} w-32`}
                />
              </div>
            </div>
            <button onClick={() => void saveBranding()} disabled={busy} className={btnPrimary}>
              {busy ? "Saving…" : "Save branding"}
            </button>

            <div className="mt-6 border-t border-[#161616]/10 pt-5">
              <h3 className="text-sm font-semibold">Custom domain</h3>
              <p className="mt-1 text-xs text-[#5a5a5a]">
                Serve this company&apos;s workspace from their own domain (e.g. app.acme.com).
                Point the domain&apos;s DNS at this app and make sure TLS terminates for it —
                see the white-label runbook. The login page shows the client&apos;s brand automatically.
              </p>
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Custom domain</label>
                <input
                  value={branding.custom_domain}
                  onChange={(e) => setBranding({ ...branding, custom_domain: e.target.value })}
                  placeholder="app.acme.com"
                  className={`${inputCls} w-full`}
                />
              </div>
            </div>

            <div className="mt-6 border-t border-[#161616]/10 pt-5">
              <h3 className="text-sm font-semibold">SSO / SAML</h3>
              <p className="mt-1 text-xs text-[#5a5a5a]">
                Let the client&apos;s team sign in with their identity provider (Okta, Entra ID, Google Workspace…).
                After saving, register the SAML provider in the Supabase dashboard (Authentication → Sign In / Up →
                SSO) using the client&apos;s IdP metadata, then paste the provider ID below.
              </p>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={branding.sso_enabled}
                  onChange={(e) => setBranding({ ...branding, sso_enabled: e.target.checked })}
                  className="h-4 w-4 accent-[#245c5c]"
                />
                Enable SSO for this company
              </label>
              {branding.sso_enabled && (
                <div className="mt-3 grid gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Email domain</label>
                    <input
                      value={branding.sso_domain}
                      onChange={(e) => setBranding({ ...branding, sso_domain: e.target.value })}
                      placeholder="acme.com"
                      className={`${inputCls} w-full`}
                    />
                    <p className="mt-1 text-xs text-[#5a5a5a]">Users signing in with an @acme.com email get the SSO button.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Supabase SSO provider ID</label>
                    <input
                      value={branding.sso_provider_id}
                      onChange={(e) => setBranding({ ...branding, sso_provider_id: e.target.value })}
                      placeholder="paste from Supabase dashboard"
                      className={`${inputCls} w-full font-mono text-xs`}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "Branding & domain" && (
        <div className="mt-6">
          <BrandingDomainTab workspaceId={workspaceId} />
        </div>
      )}

      {tab === "Security" && (
        <div className="mt-6">
          <CompanySecurityTab workspaceId={workspaceId} />
        </div>
      )}

      {tab === "Plan" && (
        <div className="mt-6 max-w-lg rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
          <h2 className="text-base font-semibold">Plan</h2>
          <p className="mt-1 text-xs text-[#5a5a5a]">Applied immediately. Stripe subscriptions are managed separately in the Stripe dashboard.</p>
          <div className="mt-4 flex items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Current plan</label>
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls}>
                {PLANS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <button onClick={() => void savePlan()} disabled={busy} className={btnPrimary}>
              {busy ? "Saving…" : "Set plan"}
            </button>
          </div>
        </div>
      )}

      {tab === "Plan & limits" && (
        <div className="mt-6">
          <CompanyPlanLimitsTab workspaceId={workspaceId} />
        </div>
      )}

      {tab === "Feature flags" && (
        <div className="mt-6">
          <CompanyFeatureFlagsTab workspaceId={workspaceId} />
        </div>
      )}

      {tab === "Support access" && (
        <div className="mt-6">
          <CompanySupportAccessTab workspaceId={workspaceId} />
        </div>
      )}

      {tab === "Audit log" && (
        <div className="mt-6">
          <CompanyAuditTab workspaceId={workspaceId} />
          <h2 className="mb-2 mt-8 text-base font-semibold">Legacy admin actions</h2>
          <div className="overflow-hidden rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
            {audit.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-[#5a5a5a]">No admin actions recorded yet.</p>
            )}
            {audit.map((a) => (
              <div key={a.id} className="border-b border-[#161616]/8 px-4 py-3 last:border-0">
                <div className="text-sm">
                  <span className="font-medium">{a.actor_email}</span>{" "}
                  <span className="rounded bg-[#161616]/8 px-1.5 py-0.5 font-mono text-xs">{a.action}</span>{" "}
                  {a.target_email && <span className="text-[#5a5a5a]">→ {a.target_email}</span>}
                </div>
                <div className="mt-0.5 text-xs text-[#5a5a5a]">
                  {new Date(a.created_at).toLocaleString()}
                  {a.details && Object.keys(a.details).length > 0 && (
                    <span> · {JSON.stringify(a.details)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <button onClick={() => void load()} disabled={busy} className={btnGhost}>
          Refresh
        </button>
      </div>
    </div>
  );
}
