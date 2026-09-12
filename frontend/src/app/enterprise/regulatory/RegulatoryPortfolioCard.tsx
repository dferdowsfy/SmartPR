// ============================================================================
// RegulatoryPortfolioCard (Phase 5) — recent verified regulatory changes plus
// the affected-facilities count, linking into /enterprise/regulatory.
// Self-contained: pass a workspaceId and it loads its own data.
// The coordinator wires this into /enterprise/page.tsx.
// ============================================================================
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LIFECYCLE_LABELS } from "../../../lib/enterprise-regulatory";

interface CardEvent {
  id: string;
  title: string;
  lifecycle: string;
  regulatory_source: string | null;
  verification_date: string | null;
  created_at: string;
}

const BADGE: Record<string, string> = {
  proposed: "bg-[#161616]/8 text-[#161616]/70",
  pending_review: "bg-amber-100 text-amber-900",
  enacted_not_effective: "bg-blue-100 text-blue-900",
  effective: "bg-emerald-100 text-emerald-900",
  superseded: "bg-[#161616]/8 text-[#161616]/40 line-through",
};

export function RegulatoryPortfolioCard({ workspaceId }: { workspaceId: string }) {
  const [events, setEvents] = useState<CardEvent[]>([]);
  const [facilityCount, setFacilityCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/enterprise/regulatory/events?workspace_id=${workspaceId}`
        );
        if (!res.ok) throw new Error("unavailable");
        const d = await res.json();
        const all: CardEvent[] = d.events ?? [];
        const recent = all
          .filter((e) => e.verification_date || e.lifecycle === "effective")
          .sort(
            (a, b) =>
              new Date(b.verification_date ?? b.created_at).getTime() -
              new Date(a.verification_date ?? a.created_at).getTime()
          )
          .slice(0, 4);
        if (!cancelled) {
          setEvents(recent);
          setLoaded(true);
        }
        // Affected facilities across the recent changes (top 3 reports).
        const facilityIds = new Set<string>();
        for (const e of recent.slice(0, 3)) {
          try {
            const rr = await fetch(
              `/api/enterprise/regulatory/events/${e.id}/report?workspace_id=${workspaceId}`
            );
            if (!rr.ok) continue;
            const rd = await rr.json();
            for (const f of rd.affected?.facilities ?? []) facilityIds.add(f.id);
          } catch {
            // per-event report failure: skip, keep the rest
          }
          if (cancelled) return;
        }
        if (!cancelled) setFacilityCount(facilityIds.size);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return (
    <section className="rounded-xl border border-[#161616]/12 bg-white p-5" aria-label="Regulatory changes">
      <h2 className="text-base font-semibold">Recent regulatory changes</h2>
      <p className="mt-1 text-xs text-[#5a5a5a]">
        Verified changes and the facilities they affect.
      </p>
      {!loaded ? (
        <p className="mt-4 text-sm text-[#8a8a8a]">Loading…</p>
      ) : events.length === 0 ? (
        <p className="mt-4 text-sm text-[#8a8a8a]">
          No verified regulatory changes yet. Regulatory change tracking will appear here
          once available.
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-[#161616]/8">
            {events.map((ev) => (
              <li key={ev.id} className="py-3">
                <Link
                  href={`/enterprise/regulatory/${ev.id}?workspace_id=${workspaceId}`}
                  className="text-sm font-medium hover:text-brand"
                >
                  {ev.title}
                </Link>
                <div className="mt-1 text-xs text-[#5a5a5a]">
                  <span
                    className={`mr-2 inline-block rounded-full px-2 py-0.5 ${
                      BADGE[ev.lifecycle] ?? BADGE.proposed
                    }`}
                  >
                    {LIFECYCLE_LABELS[ev.lifecycle as keyof typeof LIFECYCLE_LABELS] ?? ev.lifecycle}
                  </span>
                  {ev.regulatory_source ?? ""}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <strong>{facilityCount ?? "—"}</strong>{" "}
            <span className="text-[#5a5a5a]">facilities affected</span>
          </p>
        </>
      )}
      <Link
        href={`/enterprise/regulatory?workspace_id=${workspaceId}`}
        className="mt-3 inline-block text-sm font-medium text-brand hover:underline"
      >
        Open regulatory review →
      </Link>
    </section>
  );
}

export default RegulatoryPortfolioCard;
