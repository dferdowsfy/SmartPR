"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopNav } from "../../../../history/ui";
import { MATTER_TYPES, type DueDateSource, type MatterType } from "../../../../compliance/types";
import { L, type Lang } from "../../../../i18n";

const LABELS: Partial<Record<MatterType, string>> = {
  NEW_BUSINESS_FORMATION: "New business formation",
  ANNUAL_REPORT: "Annual report",
  ANNUAL_FEE: "Annual fee",
  PERMISO_UNICO_RENEWAL: "Permiso Único renewal",
  HEALTH_LICENSE_RENEWAL: "Health license renewal",
  MUNICIPAL_LICENSE_RENEWAL: "Municipal license renewal",
  CHANGE_OF_ADDRESS: "Change of address",
  CHANGE_OF_OWNER: "Change of owner",
  SECOND_LOCATION: "Second location",
  PERMIT_MODIFICATION: "Permit modification",
  OTHER: "Other regulatory filing",
};

const SOURCE_LABELS: Record<DueDateSource, string> = {
  USER_PROVIDED: "User provided",
  DOCUMENT_EXTRACTED: "Document extracted",
  EXTERNALLY_VERIFIED: "Externally verified",
  REGULATORY_RULE: "Regulatory rule",
  UNKNOWN: "Unknown",
};

export default function NewMatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const lang: Lang = useMemo(() => {
    try {
      if (typeof window === "undefined") return "en";
      return window.localStorage.getItem("smartpr-lang") === "es" ? "es" : "en";
    } catch { return "en"; }
  }, []);
  const [matterType, setMatterType] = useState<MatterType>("PERMISO_UNICO_RENEWAL");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueSource, setDueSource] = useState<DueDateSource>("USER_PROVIDED");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    const response = await fetch("/api/matters", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: id, matter_type: matterType, title: title.trim() || undefined,
        due_date: dueDate || undefined, due_date_source: dueDate ? dueSource : undefined,
        source_reference: reference.trim() || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(result.error || L("Could not start this filing.", lang)); return; }
    // Back to the business profile so the new filing and its due date show up
    // in the upcoming-dates dashboard right away.
    router.push(`/businesses/${id}`);
  };

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="businesses" />
      <main className="mx-auto max-w-2xl px-5 py-8">
        <Link href={`/businesses/${id}`} className="text-sm font-semibold text-[#245c5c]">← {L("Business profile", lang)}</Link>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#245c5c]">{L("New matter", lang)}</p>
          <h1 className="mt-1 text-2xl font-bold text-[#161616]">{L("Start a filing or renewal", lang)}</h1>
          <p className="mt-1 text-sm text-slate-500">{L("The matter stays beneath this business and opens in the same SmartPR rules and document workflow.", lang)}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{L("Matter type", lang)}</span><select value={matterType} onChange={(event) => setMatterType(event.target.value as MatterType)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]">{MATTER_TYPES.filter((type) => type !== "NEW_BUSINESS_FORMATION").map((type) => <option key={type} value={type}>{L(LABELS[type], lang)}</option>)}</select></label>
            <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{L("Title", lang)} <span className="font-normal text-slate-400">{L("(optional)", lang)}</span></span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={L(LABELS[matterType], lang)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-[#161616]" /></label>
            <div className="rounded-xl border border-slate-200 bg-[#f4f1ea] p-4">
              <div className="text-xs font-bold text-slate-600">{L("Known due date", lang)} <span className="font-normal text-slate-400">{L("(optional)", lang)}</span></div>
              <p className="mt-1 text-xs text-slate-500">{L("Leave this blank if the date is not known. SmartPR will not infer one.", lang)}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><select value={dueSource} onChange={(event) => setDueSource(event.target.value as DueDateSource)} disabled={!dueDate} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50">{(Object.keys(SOURCE_LABELS) as DueDateSource[]).filter((s) => s !== "UNKNOWN").map((s) => <option key={s} value={s}>{L(SOURCE_LABELS[s], lang)}</option>)}</select></div>
              {dueDate && <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={L("Source reference", lang)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />}
            </div>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <button disabled={busy} className="w-full rounded-xl bg-[#161616] py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? L("Starting filing…", lang) : L("Start filing", lang)}</button>
          </form>
        </div>
      </main>
    </div>
  );
}
