"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { L } from "../i18n";
import { useLang } from "../useLang";
import { AnnualFilingsView, type FilingsPortfolio } from "../compliance/AnnualFilingsView";

function FilingsContent() {
  const searchParams = useSearchParams();
  const lang = useLang();
  const [data, setData] = useState<FilingsPortfolio | null>(null);
  useEffect(() => {
    fetch("/api/portfolio").then((response) => response.json()).then(setData).catch(() => setData({}));
  }, []);
  return (
    <div className="page-viewport bg-[#f4f1ea]">
      <main className="mx-auto max-w-5xl px-5 py-8">
        <AnnualFilingsView data={data} lang={lang} initialBusiness={searchParams.get("business") || ""} />
      </main>
    </div>
  );
}
function FilingsFallback() {
  const lang = useLang();
  return <div className="page-viewport bg-[#f4f1ea]"><div className="p-12 text-center text-slate-500">{L("Loading filings…", lang)}</div></div>;
}

export default function FilingsPage() {
  return (
    <Suspense fallback={<FilingsFallback />}>
      <FilingsContent />
    </Suspense>
  );
}
