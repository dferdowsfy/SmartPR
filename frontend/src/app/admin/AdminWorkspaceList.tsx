"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface WorkspaceRow {
  id: string;
  name: string;
  kind: string;
  plan: string | null;
  subscription_status: string | null;
  owner_email: string | null;
  member_count: number;
  business_count: number;
  created_at: string;
}

export function AdminWorkspaceList() {
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/workspaces");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load companies.");
        setRows(data.workspaces || []);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-sm text-[#5a5a5a]">Loading companies…</p>;
  if (err) return <p className="text-sm text-[#8a2f2f]">{err}</p>;

  return (
    <div className="overflow-x-auto rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#161616]/10 text-xs uppercase tracking-wide text-[#5a5a5a]">
            <th className="px-4 py-3 font-medium">Company</th>
            <th className="px-4 py-3 font-medium">Plan</th>
            <th className="px-4 py-3 font-medium">Team</th>
            <th className="px-4 py-3 font-medium">Businesses</th>
            <th className="px-4 py-3 font-medium">Owner</th>
            <th className="px-4 py-3 font-medium"><span className="sr-only">Manage</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className="border-b border-[#161616]/8 last:border-0 hover:bg-[#161616]/3">
              <td className="px-4 py-3">
                <Link href={`/admin/workspaces/${w.id}`} className="font-medium text-brand underline-offset-4 hover:underline">
                  {w.name}
                </Link>
                <div className="text-xs text-[#5a5a5a]">{w.kind.toLowerCase()}</div>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
                  {w.plan || "free"}
                </span>
              </td>
              <td className="px-4 py-3">{w.member_count}</td>
              <td className="px-4 py-3">{w.business_count}</td>
              <td className="px-4 py-3 text-xs text-[#5a5a5a]">{w.owner_email || "—"}</td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/admin/workspaces/${w.id}`}
                  className="text-sm font-medium text-brand underline-offset-4 hover:underline"
                >
                  Manage →
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#5a5a5a]">No companies yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
