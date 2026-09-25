"use client";

// ============================================================================
// Admin: government template library and field mappings.
//
// Shows exactly what SmartPR holds for each government artifact — source
// provenance, checksum, population method, how many fields are mapped, and how
// many mappings a human still has to confirm. The preview link renders the real
// artifact with every mapping boundary drawn on it, which is how coordinate
// overlays get validated before anything is filed.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

interface TemplateRow {
  formCode: string;
  title: string;
  agency: string;
  scope: string;
  artifactType: string;
  sourceStatus: string;
  populationMethod: string;
  submissionChannel: string;
  revision: string | null;
  sourceFile: string | null;
  storagePath: string | null;
  checksum: string | null;
  pageCount: number;
  hasAcroForm: boolean;
  nativeFieldCount: number;
  mappedFieldCount: number;
  totalFieldCount: number;
  needsReviewCount: number;
  mappingStatus: string;
  notes: string[];
  previewUrl: string | null;
}

interface MunicipalIssue {
  municipality: string;
  requirementCode: string;
  problem: string;
}

const ARTIFACT_TONE: Record<string, string> = {
  official_pdf_form: "bg-emerald-50 text-emerald-700",
  official_docx_form: "bg-emerald-50 text-emerald-700",
  genericized_municipal_template: "bg-amber-50 text-amber-800",
  portal_submission: "bg-sky-50 text-sky-700",
};

export default function FormMappingsAdminPage() {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [issues, setIssues] = useState<MunicipalIssue[]>([]);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/forms/artifacts/templates");
    if (response.status === 403) {
      setForbidden(true);
      return;
    }
    const body = (await response.json()) as { templates: TemplateRow[]; municipalIssues: MunicipalIssue[] };
    setRows(body.templates);
    setIssues(body.municipalIssues ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    // The fetch is the external system here; state is only set from its
    // callback, and never synchronously inside the effect body.
    void (async () => {
      if (!active) return;
      await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  if (forbidden) {
    return (
      <div className="page-viewport bg-[#f4f1ea]">
        
        <div className="mx-auto max-w-5xl px-5 py-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <h1 className="text-xl font-bold text-[#161616]">Not authorized</h1>
            <p className="mt-2 text-sm text-[#161616]/60">
              This area is restricted to administrators. Ask an administrator to add your account to{" "}
              <code className="rounded bg-slate-100 px-1">ADMIN_EMAILS</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-viewport bg-[#f4f1ea]">
      
      <div className="mx-auto max-w-6xl px-5 py-8">
        <h1 className="text-2xl font-bold text-[#161616]">Government template library</h1>
        <p className="mt-1 text-sm text-[#161616]/60">
          Every artifact SmartPR knows about, including the ones it has no file for. Genericized municipal templates are
          usable for field mapping and demonstrations only — they are never presented as a municipality&apos;s official form.
        </p>

        {issues.length > 0 && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <div className="font-semibold">Municipality adapter problems</div>
            <ul className="mt-2 list-disc pl-5">
              {issues.map((issue, i) => (
                <li key={i}>
                  {issue.municipality} · {issue.requirementCode}: {issue.problem}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!rows && <div className="mt-6 text-sm text-[#161616]/50">Loading…</div>}

        <div className="mt-4 grid gap-3">
          {(rows ?? []).map((row) => (
            <div key={row.formCode} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-[#161616]">
                    {row.formCode} · {row.title}
                  </div>
                  <div className="text-xs text-[#161616]/60">
                    {row.agency} · {row.scope}
                    {row.revision ? ` · ${row.revision}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ARTIFACT_TONE[row.artifactType] ?? "bg-slate-100 text-slate-700"}`}>
                    {row.artifactType}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{row.sourceStatus}</span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs text-[#161616]/80 md:grid-cols-4">
                <div>
                  <span className="text-[#161616]/50">Population</span>
                  <div>{row.populationMethod}</div>
                </div>
                <div>
                  <span className="text-[#161616]/50">Native fields</span>
                  <div>{row.hasAcroForm ? row.nativeFieldCount : "none (overlay)"}</div>
                </div>
                <div>
                  <span className="text-[#161616]/50">Mapped</span>
                  <div>
                    {row.mappedFieldCount}/{row.totalFieldCount}
                    {row.needsReviewCount > 0 && (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                        {row.needsReviewCount} need review
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-[#161616]/50">Pages</span>
                  <div>{row.pageCount || "—"}</div>
                </div>
              </div>

              <div className="mt-2 grid gap-1 text-[11px] text-[#161616]/55">
                <div>Source file: {row.sourceFile ?? "not in the library yet"}</div>
                <div>Storage: {row.storagePath ?? "—"}</div>
                <div>Checksum: {row.checksum ? `${row.checksum.slice(0, 23)}…` : "—"}</div>
              </div>

              {row.notes.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-[11px] text-[#161616]/60">
                  {row.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}

              {row.previewUrl && (
                <a
                  href={row.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block rounded-full border border-[#161616] px-4 py-1.5 text-xs font-medium text-[#161616]"
                >
                  Open mapping preview
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
