"use client";

// ============================================================================
// PR 7 (deliverable): client-side generation of the submission package as a
// government-style PDF and a ZIP bundle (PDF + machine-readable JSON per form
// + manifest). Mirrors the jsPDF approach already used in app/page.tsx.
//
// GUARDRAIL: the deliverable is a READINESS package. It is never submitted to
// a government portal and asserts no legal sufficiency.
// ============================================================================

import { jsPDF } from "jspdf";
import JSZip from "jszip";
import type { SubmissionPackage, PackagedForm } from "./types";

const navy: [number, number, number] = [10, 37, 64];
const slate: [number, number, number] = [71, 85, 105];

// jsPDF built-in fonts are WinAnsi (Latin-1) only; strip unsupported glyphs but
// keep Spanish accents (ó/í/ñ). Same approach as the readiness report.
function san(s: unknown): string {
  return (s ?? "")
    .toString()
    .replace(/[✓✔]/g, "[x]")
    .replace(/[⬜☐▢]/g, "[ ]")
    .replace(/[→➔]/g, "->")
    .replace(/[•·]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x00-\xFF]/g, "")
    .trim();
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function generatePackagePDF(pkg: SubmissionPackage): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 18;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const lineH = 5.2;
  let y = 0;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - 16) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const write = (
    text: string,
    x: number,
    opts: { size?: number; color?: [number, number, number]; gap?: number; bold?: boolean } = {}
  ) => {
    const { size = 10, color = navy, gap = 1.5, bold = false } = opts;
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const maxW = CONTENT_W - (x - MARGIN);
    for (const ln of doc.splitTextToSize(san(text), maxW)) {
      ensureSpace(lineH);
      doc.text(ln, x, y);
      y += lineH;
    }
    y += gap;
  };

  const heading = (label: string) => {
    y += 2;
    ensureSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...navy);
    doc.text(san(label), MARGIN, y);
    y += 2.5;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
  };

  // Header band
  doc.setFillColor(...navy);
  doc.rect(0, 0, PAGE_W, 20, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("SMARTPR", MARGIN, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("SUBMISSION READINESS PACKAGE", MARGIN + 34, 13);

  y = 32;
  doc.setTextColor(...navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Submission Package", MARGIN, y);
  y += 8;

  write(`Generated: ${new Date(pkg.generatedAt).toLocaleString()}`, MARGIN, { size: 9, color: slate, gap: 0.5 });
  write(`Readiness: ${pkg.readiness === "ready" ? "Ready to assemble" : "Incomplete"}`, MARGIN, {
    size: 9,
    color: slate,
    gap: 0.5,
  });
  write(`Forms included: ${pkg.forms.length}`, MARGIN, { size: 9, color: slate });

  // Each completed form
  for (const form of pkg.forms) {
    heading(form.requirementName || form.templateName || "Required form");
    if (form.agency) write(`Agency: ${form.agency}`, MARGIN, { size: 9, color: slate, gap: 0.5 });
    if (form.source.domain) write(`Source: ${form.source.url || form.source.domain}`, MARGIN, { size: 8, color: slate, gap: 0.5 });
    write(`Status: ${form.status}`, MARGIN, { size: 9, color: slate });

    const entries = Object.entries(form.formData || {});
    if (entries.length === 0) {
      write("(no data entered)", MARGIN + 2, { size: 9, color: slate });
    } else {
      for (const [key, value] of entries) {
        const v = value === true ? "Yes" : value === false ? "No" : value == null || value === "" ? "—" : String(value);
        write(`${humanizeKey(key)}: ${v}`, MARGIN + 2, { size: 9, gap: 0.5 });
      }
    }

    if (form.validation && form.validation.status !== "complete") {
      y += 1;
      write("Open items:", MARGIN + 2, { size: 9, bold: true, color: slate, gap: 0.5 });
      for (const m of form.validation.missingFields) write(`- Missing: ${humanizeKey(m)}`, MARGIN + 4, { size: 9, color: slate, gap: 0.3 });
      for (const m of form.validation.missingAttachments) write(`- Missing attachment: ${humanizeKey(m)}`, MARGIN + 4, { size: 9, color: slate, gap: 0.3 });
      for (const b of form.validation.blockingIssues) write(`- ${b}`, MARGIN + 4, { size: 9, color: slate, gap: 0.3 });
    }
  }

  // Open issues + disclaimer
  if (pkg.openIssues.length > 0) {
    heading("Open Issues");
    for (const issue of pkg.openIssues) write(`- ${issue}`, MARGIN + 2, { size: 9, color: slate, gap: 0.4 });
  }

  heading("Disclaimer");
  write(pkg.disclaimer, MARGIN, { size: 8, color: slate });

  return doc.output("blob");
}

/** Optional binary payloads keyed by evidenceId for locker files in the ZIP. */
export type EvidenceBinaryMap = Record<string, Blob | ArrayBuffer | Uint8Array>;

/** Build a ZIP bundle: the PDF, a manifest, forms JSON, and locker evidence. */
export async function generatePackageZip(
  pkg: SubmissionPackage,
  evidenceBinaries?: EvidenceBinaryMap
): Promise<Blob> {
  const zip = new JSZip();
  zip.file("submission-package.pdf", generatePackagePDF(pkg));
  const evidenceFiles = pkg.evidenceFiles ?? [];
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        generatedAt: pkg.generatedAt,
        readiness: pkg.readiness,
        formCount: pkg.forms.length,
        evidenceCount: evidenceFiles.length,
        openIssues: pkg.openIssues,
        disclaimer: pkg.disclaimer,
        evidence: evidenceFiles,
      },
      null,
      2
    )
  );
  const formsDir = zip.folder("forms");
  pkg.forms.forEach((form: PackagedForm, i) => {
    const safe = (form.requirementName || form.templateName || `form-${i + 1}`)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();
    formsDir?.file(`${String(i + 1).padStart(2, "0")}-${safe}.json`, JSON.stringify(form, null, 2));
  });
  if (evidenceFiles.length > 0) {
    const evidenceDir = zip.folder("evidence");
    evidenceDir?.file(
      "index.json",
      JSON.stringify({ count: evidenceFiles.length, files: evidenceFiles }, null, 2)
    );
    for (const file of evidenceFiles) {
      const binary = evidenceBinaries?.[file.evidenceId];
      if (binary) {
        zip.file(file.zipPath, binary);
      } else {
        zip.file(
          `${file.zipPath}.stub.json`,
          JSON.stringify(
            {
              note: "Binary not embedded in this client bundle; download via /api/evidence/{id}/download or business evidence-package.",
              ...file,
            },
            null,
            2
          )
        );
      }
    }
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
