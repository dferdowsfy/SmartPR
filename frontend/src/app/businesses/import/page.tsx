"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, FileSearch, FileUp, ShieldCheck, X } from "lucide-react";
import { TopNav } from "../../history/ui";
import { initKbFromServer, KB } from "../../kb";
import type { DueDateSource, ImportedEvidence, ObligationBlueprint } from "../../compliance/types";

interface Profile {
  legal_name: string;
  entity_number: string;
  business_structure: string;
  business_type: string;
  industry: string;
  municipality: string;
  physical_address: string;
  location_type: string;
}

interface EvidenceDraft extends ImportedEvidence {
  id: string;
  file: File;
  analyzing: boolean;
  analysis_error?: string | null;
  storage_error?: string | null;
}

const STRUCTURES = [
  ["sole_proprietorship", "Sole proprietorship"], ["llc", "Limited liability company (LLC)"],
  ["corporation", "Corporation"], ["partnership", "Partnership"],
  ["professional_corporation", "Professional corporation"], ["other", "Other"],
] as const;

const CONTEXT = [
  ["food_prepared_or_sold", "Prepares or sells food"], ["alcohol_sold", "Sells or serves alcohol"],
  ["employees_hired", "Has employees"], ["healthcare_services", "Provides healthcare services"],
  ["professional_licenses_required", "Uses licensed professionals"], ["hazardous_materials", "Handles hazardous materials"],
  ["vehicles_used", "Uses commercial vehicles"], ["commercial_signage", "Has commercial signage"],
  ["outdoor_seating", "Has outdoor seating"], ["live_entertainment", "Offers live entertainment"],
] as const;

async function textFromFile(file: File): Promise<string> {
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return (await file.text()).slice(0, 7500);
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 15); pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => {
        const textItem = item as { str?: unknown };
        return typeof textItem.str === "string" ? textItem.str : "";
      }).join(" "));
    }
    return pages.join("\n").slice(0, 7500);
  } catch {
    return "[No selectable text could be extracted from this PDF. Manual review is required.]";
  }
}

export default function ExistingBusinessImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [profile, setProfile] = useState<Profile>({
    legal_name: "", entity_number: "", business_structure: "llc", business_type: "",
    industry: "", municipality: "", physical_address: "", location_type: "Commercial Office",
  });
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [obligations, setObligations] = useState<ObligationBlueprint[]>([]);
  const [knowledgeSource, setKnowledgeSource] = useState("");
  const [evidence, setEvidence] = useState<EvidenceDraft[]>([]);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setKbRevision] = useState(0);

  useEffect(() => {
    void initKbFromServer().then((changed) => { if (changed) setKbRevision(1); });
  }, []);

  const municipalities = KB.municipalities.map((item) => item.name).sort();
  const businessTypes = KB.businessTypes.map((item) => item.name).sort();
  const patchProfile = (key: keyof Profile, value: string) => setProfile((current) => ({ ...current, [key]: value }));

  const preview = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    const response = await fetch("/api/businesses/import/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { ...profile, name: profile.legal_name }, answers }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(result.error || "Could not determine requirements."); return; }
    setObligations(result.obligations ?? []); setKnowledgeSource(result.knowledgeSource || "BUNDLED_KB"); setStep(2);
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setEvidence((current) => [...current, ...Array.from(files).map((file) => ({
      id: crypto.randomUUID(), file, original_filename: file.name, mime_type: file.type || null,
      size_bytes: file.size, requirement_id: null, extracted_fields: {}, validation_result: "NEEDS_REVIEW" as const,
      due_date_source: "UNKNOWN" as const, analyzing: false,
    }))]);
  };

  const updateEvidence = (id: string, patch: Partial<EvidenceDraft>) =>
    setEvidence((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  const analyze = async (item: EvidenceDraft) => {
    updateEvidence(item.id, { analyzing: true, analysis_error: null, storage_error: null });
    const matched = obligations.find((obligation) => obligation.requirementId === item.requirement_id);
    let storagePath: string | null = item.storage_path ?? null;
    let storageError: string | null = null;
    try {
      const form = new FormData(); form.append("file", item.file);
      const storageResponse = await fetch("/api/evidence/upload", { method: "POST", body: form });
      const stored = await storageResponse.json().catch(() => ({}));
      if (storageResponse.ok) storagePath = stored.storage_path;
      else storageError = stored.error || "File storage unavailable.";
    } catch { storageError = "File storage unavailable."; }

    try {
      const content = await textFromFile(item.file);
      const response = await fetch("/api/analyze-document", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: item.file.name, content, requirement_code: matched?.requirementId || "",
          business_context: { name: profile.legal_name, municipality: profile.municipality, address: profile.physical_address },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Document analysis unavailable.");
      const analysis = result.analysis ?? {};
      const extracted = analysis.extracted ?? {};
      const expiration = typeof extracted.expiration_date === "string" ? extracted.expiration_date : null;
      const issue = typeof extracted.issue_date === "string" ? extracted.issue_date : null;
      updateEvidence(item.id, {
        analyzing: false, storage_path: storagePath, storage_error: storageError,
        extracted_fields: extracted, extraction_confidence: typeof analysis.confidence === "number" ? analysis.confidence : null,
        validation_result: analysis.extraction?.validation_result || "NEEDS_REVIEW",
        expiration_date: expiration, issue_date: issue,
        due_date_source: expiration ? "DOCUMENT_EXTRACTED" : "UNKNOWN",
        source_reference: expiration ? `Extracted from ${item.file.name}` : null,
      });
    } catch (analysisError) {
      updateEvidence(item.id, { analyzing: false, storage_path: storagePath, storage_error: storageError, analysis_error: (analysisError as Error).message });
    }
  };

  const submit = async () => {
    setBusy(true); setError(null);
    const payloadEvidence: ImportedEvidence[] = evidence.map((item) => ({
      requirement_id: item.requirement_id,
      original_filename: item.original_filename,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      storage_path: item.storage_path,
      extracted_fields: item.extracted_fields,
      extraction_confidence: item.extraction_confidence,
      validation_result: item.validation_result,
      issue_date: item.issue_date,
      expiration_date: item.expiration_date,
      due_date_source: item.due_date_source,
      source_reference: item.source_reference,
    }));
    const response = await fetch("/api/businesses/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { ...profile, name: profile.legal_name }, answers, evidence: payloadEvidence, unknown_requirement_ids: [...unknown] }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(result.error || "Could not import this business."); return; }
    router.push(`/businesses/${result.business_public_id || result.business_id}`);
  };

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="businesses" />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <Link href="/dashboard" className="text-sm font-semibold text-[#245c5c]">← Portfolio dashboard</Link>
        <div className="mt-4 flex items-center gap-3"><span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${step === 1 ? "bg-[#161616] text-white" : "bg-emerald-100 text-emerald-700"}`}>{step === 1 ? "1" : "✓"}</span><span className="text-sm font-semibold text-[#161616]">Business profile</span><div className="h-px flex-1 bg-slate-200" /><span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${step === 2 ? "bg-[#161616] text-white" : "bg-slate-200 text-slate-500"}`}>2</span><span className="text-sm font-semibold text-[#161616]">Compliance reconstruction</span></div>

        {step === 1 ? (
          <form onSubmit={preview} className="mt-6 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#245c5c]">Manage an existing business</p>
            <h1 className="mt-1 text-2xl font-bold text-[#161616]">Create the permanent business profile</h1>
            <p className="mt-1 text-sm text-slate-500">SmartPR will evaluate this profile through the same deterministic regulatory rules engine used for new formations.</p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-600">Business legal name *</span><input required value={profile.legal_name} onChange={(event) => patchProfile("legal_name", event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-[#161616]" /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-600">Entity number <span className="font-normal text-slate-400">(if known)</span></span><input value={profile.entity_number} onChange={(event) => patchProfile("entity_number", event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-[#161616]" /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-600">Business structure *</span><select required value={profile.business_structure} onChange={(event) => patchProfile("business_structure", event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]">{STRUCTURES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-600">Business type *</span><select required value={profile.business_type} onChange={(event) => patchProfile("business_type", event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]"><option value="">Select business type</option>{businessTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-600">Industry</span><input value={profile.industry} onChange={(event) => patchProfile("industry", event.target.value)} placeholder="e.g. Food service" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-[#161616]" /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-600">Municipality *</span><select required value={profile.municipality} onChange={(event) => patchProfile("municipality", event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]"><option value="">Select municipality</option>{municipalities.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-600">Location type</span><select value={profile.location_type} onChange={(event) => patchProfile("location_type", event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]"><option>Commercial Office</option><option>Retail Storefront</option><option>Restaurant / Food Service</option><option>Warehouse</option><option>Home-Based Business</option><option>Online Only</option></select></label>
              <label className="md:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-600">Physical address</span><textarea value={profile.physical_address} onChange={(event) => patchProfile("physical_address", event.target.value)} rows={2} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-[#161616]" /></label>
            </div>
            <fieldset className="mt-6"><legend className="text-sm font-bold text-[#161616]">Relevant operating context</legend><p className="mt-1 text-xs text-slate-500">These facts are inputs to the rules engine. Select only what applies.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{CONTEXT.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700"><input type="checkbox" checked={Boolean(answers[key])} onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-[#245c5c]" />{label}</label>)}</div></fieldset>
            {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <button disabled={busy} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#161616] py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Evaluating profile…" : "Determine required obligations"}<ArrowRight className="h-4 w-4" /></button>
          </form>
        ) : (
          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#245c5c]" /><div><h1 className="text-xl font-bold text-[#161616]">Required obligations</h1><p className="mt-1 text-sm text-slate-500">Generated from the {knowledgeSource === "PUBLISHED_SNAPSHOT" ? "published regulatory graph" : "bundled deterministic knowledge base"}. AI cannot add obligations; it is used only to extract fields from evidence.</p></div></div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">{obligations.map((obligation) => <label key={obligation.requirementId} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"><input type="checkbox" checked={unknown.has(obligation.requirementId)} onChange={(event) => setUnknown((current) => { const next = new Set(current); if (event.target.checked) next.add(obligation.requirementId); else next.delete(obligation.requirementId); return next; })} className="mt-1 h-4 w-4 accent-[#245c5c]" /><span><span className="block text-sm font-semibold text-[#161616]">{obligation.name}</span><span className="block text-xs text-slate-500">{obligation.agency || "Agency not recorded"}</span><span className="mt-1 block text-[11px] text-slate-400">Check if the current status or expiration still needs to be determined.</span></span></label>)}</div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-lg font-bold text-[#161616]">Existing permits, licenses, and certificates</h2><p className="text-sm text-slate-500">Match each upload only to an obligation already generated by the rules engine.</p></div><label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#245c5c] px-4 py-2.5 text-sm font-semibold text-white"><FileUp className="h-4 w-4" /> Upload documents<input type="file" multiple accept=".pdf,.txt,.png,.jpg,.jpeg" onChange={(event) => addFiles(event.target.files)} className="hidden" /></label></div>
              {evidence.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">Upload current evidence, or continue and set dates later.</div> : <div className="mt-5 space-y-4">{evidence.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-[#161616]">{item.original_filename}</div><div className="text-xs text-slate-400">{Math.ceil((item.size_bytes || 0) / 1024)} KB</div></div><button onClick={() => setEvidence((current) => current.filter((entry) => entry.id !== item.id))} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
                <div className="mt-3 grid gap-3 md:grid-cols-2"><label><span className="mb-1 block text-xs font-bold text-slate-600">Match to required obligation</span><select value={item.requirement_id || ""} onChange={(event) => updateEvidence(item.id, { requirement_id: event.target.value || null })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Unmatched evidence</option>{obligations.map((obligation) => <option key={obligation.requirementId} value={obligation.requirementId}>{obligation.name}</option>)}</select></label><div className="flex items-end"><button disabled={item.analyzing || !item.requirement_id} onClick={() => void analyze(item)} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#245c5c] px-3 py-2 text-sm font-semibold text-[#245c5c] disabled:opacity-40"><FileSearch className="h-4 w-4" />{item.analyzing ? "Extracting and storing…" : "Analyze document"}</button></div>
                  <label><span className="mb-1 block text-xs font-bold text-slate-600">Issue / filing date</span><input type="date" value={item.issue_date || ""} onChange={(event) => updateEvidence(item.id, { issue_date: event.target.value || null })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                  <label><span className="mb-1 block text-xs font-bold text-slate-600">Expiration / due date</span><input type="date" value={item.expiration_date || ""} onChange={(event) => updateEvidence(item.id, { expiration_date: event.target.value || null, due_date_source: event.target.value ? "USER_PROVIDED" : "UNKNOWN", source_reference: event.target.value ? "Entered during existing-business onboarding" : null })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                  <label><span className="mb-1 block text-xs font-bold text-slate-600">Date source</span><select value={item.due_date_source || "UNKNOWN"} onChange={(event) => updateEvidence(item.id, { due_date_source: event.target.value as DueDateSource })} disabled={!item.expiration_date} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"><option value="UNKNOWN">Unknown</option><option value="DOCUMENT_EXTRACTED">Document extracted</option><option value="USER_PROVIDED">User provided</option><option value="EXTERNALLY_VERIFIED">Externally verified</option></select></label>
                  <label><span className="mb-1 block text-xs font-bold text-slate-600">Evidence review</span><select value={item.validation_result || "NEEDS_REVIEW"} onChange={(event) => updateEvidence(item.id, { validation_result: event.target.value as ImportedEvidence["validation_result"] })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="PASS">Fields verified</option><option value="NEEDS_REVIEW">Needs human review</option><option value="FAIL">Insufficient / rejected</option></select></label></div>
                {item.storage_path && <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Stored as private evidence</div>}
                {item.storage_error && <div className="mt-3 flex items-start gap-2 text-xs text-amber-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5" /><span>{item.storage_error} Metadata and extracted fields can still be saved, but retry storage before relying on this record.</span></div>}
                {item.analysis_error && <div className="mt-2 text-xs text-amber-700">AI extraction unavailable: {item.analysis_error}. Enter known dates manually and leave review as “Needs human review.”</div>}
              </div>)}</div>}
            </section>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><button onClick={() => setStep(1)} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-600">Back to profile</button><button disabled={busy || evidence.some((item) => item.analyzing)} onClick={() => void submit()} className="rounded-xl bg-[#161616] px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating compliance profile…" : "Create Business Compliance Profile →"}</button></div>
          </div>
        )}
      </main>
    </div>
  );
}
