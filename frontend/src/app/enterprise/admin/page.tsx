"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useEnterpriseWorkspaces } from "../_lib/useEnterpriseWorkspaces";

const CARDS = [
  {
    title: "Team",
    desc: "Members, invites, legacy roles and enterprise role assignments.",
    href: (ws: string) => `/enterprise/admin/team?workspace=${ws}`,
  },
  {
    title: "Roles & scopes",
    desc: "Grant or revoke enterprise roles at organization, business, facility or project scope.",
    href: (ws: string) => `/enterprise/admin/roles?workspace=${ws}`,
  },
  {
    title: "Security",
    desc: "SSO, domain verification, session and MFA policies.",
    href: (ws: string) => `/enterprise/admin/security?workspace=${ws}`,
  },
  {
    title: "Integrations",
    desc: "Webhooks, service accounts and API credentials.",
    href: (ws: string) => `/enterprise/admin/integrations?workspace=${ws}`,
  },
  {
    title: "Branding",
    desc: "Company name, logos, colors, custom domain and terminology.",
    href: (ws: string) => `/enterprise/admin/branding?workspace=${ws}`,
  },
  {
    title: "Reminders",
    desc: "Reminder schedules, escalation policies and deadline rules.",
    href: (ws: string) => `/enterprise/admin/reminders?workspace=${ws}`,
  },
  {
    title: "Audit log",
    desc: "Append-only record of who did what, when, and from where.",
    href: (ws: string) => `/enterprise/admin/audit?workspace=${ws}`,
  },
];

function HubInner() {
  const { workspaces, workspace, workspaceId, loading, error } = useEnterpriseWorkspaces();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#5a5a5a]">
        Organization administration
      </p>
      <h1 className="mt-1 text-3xl font-bold">Admin</h1>

      <div className="mt-4 flex items-center gap-3">
        <label htmlFor="ws" className="text-sm text-[#5a5a5a]">
          Organization
        </label>
        <select
          id="ws"
          className="rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm"
          value={workspaceId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id) window.location.search = `?workspace=${encodeURIComponent(id)}`;
          }}
          disabled={loading || workspaces.length === 0}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.role})
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="mt-8 text-sm text-[#5a5a5a]">Loading…</p>}
      {error && <p className="mt-8 text-sm text-red-700">{error}</p>}
      {!loading && !error && !workspace && (
        <p className="mt-8 text-sm text-[#5a5a5a]">
          You don&apos;t belong to any organization yet.
        </p>
      )}

      {!loading && workspace && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <Link
              key={c.title}
              href={c.href(workspace.id)}
              className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5 transition hover:border-[#161616]/35 hover:shadow-sm"
            >
              <div className="text-base font-semibold">{c.title}</div>
              <p className="mt-1 text-sm text-[#5a5a5a]">{c.desc}</p>
              <span className="mt-3 inline-block text-sm font-medium text-[#245c5c]">
                Open →
              </span>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-[#5a5a5a]">
        Security, Integrations, Branding and Reminders are managed by their own
        sections — this hub links out to them.
      </p>
    </div>
  );
}

export default function EnterpriseAdminHub() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <Suspense fallback={<p className="px-6 py-8 text-sm">Loading…</p>}>
        <HubInner />
      </Suspense>
    </div>
  );
}
