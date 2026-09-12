// /demo/enterprise — Enterprise demo entry (Phase 8).
//
// Describes the "Caribe Industrial Manufacturing LLC (Demo)" scenario, lets a
// super admin seed / reset the demo data, and links into the enterprise
// surfaces. Entering the demo requires signing in as the account that ran the
// seed (added as workspace OWNER); the six fictional demo users are
// illustrative rows only — they have no auth accounts.

"use client";

import { useEffect, useState } from "react";
import { DEMO_USERS, DEMO_FACILITIES } from "../../../lib/demo-enterprise-data";

const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";

const ROLE_LABELS: Record<string, string> = {
  org_owner: "Organization owner",
  compliance_manager: "Compliance manager",
  facility_manager: "Facility manager (Planta Norte only)",
  contributor: "Contributor",
  evidence_reviewer: "Evidence reviewer",
  auditor: "Auditor (read-only)",
};

export default function EnterpriseDemoPage() {
  const [seeded, setSeeded] = useState<boolean | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/demo/enterprise-seed");
      const data = await res.json();
      if (res.ok) {
        setSeeded(!!data.seeded);
        setWorkspaceId(data.workspaceId || null);
      } else {
        setSeeded(null);
      }
    } catch {
      setSeeded(null);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const reseed = async () => {
    if (!window.confirm("Reset the enterprise demo? All demo data will be wiped and re-seeded.")) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/enterprise-seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Seed failed.");
      setWorkspaceId(data.workspaceId);
      setSeeded(true);
      setMsg(`Demo ${data.reset ? "reset" : "seeded"}: 5 facilities, 8 obligations, evidence in all 8 states.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const qs = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";
  const links = [
    { href: `/enterprise${qs}`, label: "Portfolio dashboard", desc: "Live metrics, drill-downs, overdue and critical flags." },
    { href: `/enterprise/work${qs}`, label: "Work queue", desc: "My work, reviews, overdue, unassigned, approvals." },
    { href: `/enterprise/regulatory${qs}`, label: "Regulatory changes", desc: "The [DEMO] proposed event and its impact review." },
    { href: `/enterprise/reports${qs}`, label: "Reports", desc: "Executive reports with CSV and branded PDF export." },
  ];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#5a5a5a]">SmartPR Enterprise · Demo</p>
      <h1 className="mt-2 text-3xl font-bold text-[#161616]">Caribe Industrial Manufacturing LLC</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#3d3d3d]">
        A fictional multi-facility manufacturer used to demonstrate SmartPR’s enterprise
        compliance operations. Facilities, people, addresses, deadlines, and the webhook
        are invented for the demo — but every <strong>regulatory requirement</strong> comes
        from the real SmartPR knowledge graph (requirement rules with official sources).
        Internal due dates are labeled as internal targets; nothing here is a verified
        regulatory deadline.
      </p>

      {err && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">{err}</p>}
      {msg && <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{msg}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className={btnPrimary} disabled={busy} onClick={() => void reseed()}>
          {busy ? "Working…" : seeded ? "Reset demo data" : "Seed demo data"}
        </button>
        {seeded === false && (
          <span className="text-sm text-[#5a5a5a]">Not seeded yet. Seeding requires a super-admin account.</span>
        )}
        {seeded === null && (
          <span className="text-sm text-[#5a5a5a]">Sign in as a super admin to seed or reset the demo.</span>
        )}
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[#161616]">What the scenario contains</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#3d3d3d]">
          <li>5 facilities across San Juan, Bayamón, Guaynabo, Carolina, and Ponce</li>
          <li>8 obligations from 4 real knowledge-graph requirement rules — half assigned (one overdue on its internal target), half unassigned</li>
          <li>Evidence in all 8 enterprise states (draft → approved), with version history and review decisions</li>
          <li>One <strong>[DEMO] proposed</strong> regulatory event — clearly labeled, changes nothing</li>
          <li>Internal-target deadline schedules, audit events, notifications, and one inert demo webhook (never sends)</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[#161616]">Demo roles</h2>
        <p className="mt-1 text-sm text-[#5a5a5a]">
          Illustrative assignments (these users have no login — sign in as the seeding admin, who is workspace OWNER).
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-[#161616]/15">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#161616]/15 bg-[#fbf8f2] text-xs uppercase tracking-wide text-[#5a5a5a]">
                <th className="px-4 py-2">Person (fictional)</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Scope</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_USERS.map((u) => (
                <tr key={u.roleKey} className="border-b border-[#161616]/10 last:border-0">
                  <td className="px-4 py-2">{u.name}</td>
                  <td className="px-4 py-2">{ROLE_LABELS[u.roleKey] || u.roleKey}</td>
                  <td className="px-4 py-2 text-[#5a5a5a]">
                    {u.roleKey === "facility_manager" ? "Planta Norte (Demo) only" : "Organization"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[#161616]">Facilities</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {DEMO_FACILITIES.map((f) => (
            <li key={f.name} className="rounded-xl border border-[#161616]/15 p-3 text-sm">
              <p className="font-medium text-[#161616]">{f.name}</p>
              <p className="text-[#5a5a5a]">{f.municipality} — {f.address}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[#161616]">Explore</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-xl border border-[#161616]/15 p-4 transition hover:border-[#161616]/40"
            >
              <p className="font-medium text-[#161616]">{l.label} →</p>
              <p className="mt-1 text-sm text-[#5a5a5a]">{l.desc}</p>
            </a>
          ))}
        </div>
        {!workspaceId && (
          <p className="mt-3 text-sm text-[#5a5a5a]">
            Links activate once the demo is seeded (the workspace id is appended automatically).
          </p>
        )}
      </section>
    </main>
  );
}
