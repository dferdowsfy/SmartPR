"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface ActiveGrant {
  id: string;
  workspaceId: string;
  workspace_name: string;
  grantedToEmail: string;
  reason: string;
  scope: string;
  expiresAt: string;
}

/**
 * Persistent banner shown on every /admin page while a support-access grant
 * is active. There is no invisible impersonation: the workspace, reason,
 * scope and expiry are always visible, with a one-click revoke.
 */
export function SupportAccessBanner() {
  const [grant, setGrant] = useState<ActiveGrant | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/support-access/active");
      if (!res.ok) return;
      const d = await res.json();
      setGrant(d.grant ?? null);
    } catch {
      // Non-fatal: banner just stays hidden.
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!grant) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-amber-500 px-6 py-2 text-sm font-medium text-black"
    >
      <span className="font-bold">SUPPORT ACCESS ACTIVE</span>
      <span>
        Workspace:{" "}
        <Link
          href={`/admin/workspaces/${grant.workspaceId}`}
          className="underline"
        >
          {grant.workspace_name}
        </Link>
      </span>
      <span className="max-w-[420px] truncate" title={grant.reason}>
        Reason: {grant.reason}
      </span>
      <span>Scope: {grant.scope}</span>
      <span>Expires: {new Date(grant.expiresAt).toLocaleString()}</span>
      <button
        className="ml-auto rounded bg-black px-3 py-1 text-xs font-semibold text-white hover:bg-black/80"
        onClick={async () => {
          if (!confirm("Revoke this support-access grant now?")) return;
          const res = await fetch(
            `/api/admin/workspaces/${grant.workspaceId}/support-access/${grant.id}/revoke`,
            { method: "POST" }
          );
          if (res.ok) setGrant(null);
        }}
      >
        Revoke now
      </button>
    </div>
  );
}
