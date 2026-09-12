"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export interface EnterpriseWorkspace {
  id: string;
  name: string;
  role: string;
}

/**
 * Workspace context for the /enterprise admin UI. Reads ?workspace=, falls
 * back to the first workspace the user belongs to. Every enterprise page
 * passes the resolved id to the APIs, which re-validate membership +
 * permission server-side (the query param is a selector, never a grant).
 */
export function useEnterpriseWorkspaces() {
  const searchParams = useSearchParams();
  const [workspaces, setWorkspaces] = useState<EnterpriseWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/enterprise/workspaces");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load workspaces.");
      setWorkspaces(data.workspaces || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requested = searchParams.get("workspace");
  const workspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    if (requested) {
      const found = workspaces.find((w) => w.id === requested);
      if (found) return found;
    }
    return workspaces[0];
  }, [workspaces, requested]);

  return { workspaces, workspace, workspaceId: workspace?.id ?? null, loading, error, reload };
}
