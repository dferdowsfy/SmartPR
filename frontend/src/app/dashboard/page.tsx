"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "../history/ui";

interface PortfolioBusiness {
  id: string;
  public_id: string | null;
  legal_name: string;
  municipality: string | null;
  readiness_score: number | null;
}

interface PortfolioData {
  enabled: boolean;
  error?: string;
  businesses?: PortfolioBusiness[];
}

export default function DashboardPage() {
  const [data, setData] = useState<PortfolioData | null>(null);

  useEffect(() => {
    fetch("/api/portfolio")
      .then((response) => response.json())
      .then(setData)
      .catch(() => setData({ enabled: false, error: "network" }));
  }, []);

  const businesses = data?.businesses ?? [];

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <TopNav active="businesses" />
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">Workspace</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight sm:text-5xl">
          My businesses
        </h1>
        <p className="mt-3 max-w-xl text-[#1b1b1b]">
          Each filing keeps its own documents, forms, and readiness. Start a new one or continue where you left off.
        </p>

        <Link
          href="/?entry=new-business"
          className="mt-8 inline-flex h-12 items-center rounded-lg bg-brand px-5 text-sm font-medium text-[#f6f3ea]"
        >
          Start a new filing
        </Link>

        {!data ? (
          <p className="mt-12 text-sm text-[#5a5a5a]">Loading…</p>
        ) : businesses.length === 0 ? (
          <p className="mt-12 text-sm text-[#5a5a5a]">No businesses yet. Describe what you want to open to begin.</p>
        ) : (
          <ul className="mt-12 divide-y divide-[#161616]/12 border-y border-[#161616]/12">
            {businesses.map((row) => (
              <li key={row.id} className="grid gap-3 py-5 sm:grid-cols-[1.4fr_1fr_auto] sm:items-center">
                <div>
                  <p className="font-medium">{row.legal_name || "Untitled business"}</p>
                  <p className="text-sm text-[#5a5a5a]">{row.municipality || "Puerto Rico"}</p>
                </div>
                <p className="text-sm text-[#1b1b1b]">
                  {row.readiness_score == null ? "In progress" : `${row.readiness_score}% ready`}
                </p>
                <Link
                  href={`/businesses/${row.public_id || row.id}`}
                  className="justify-self-start text-sm text-brand underline-offset-4 hover:underline sm:justify-self-end"
                >
                  Continue
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
