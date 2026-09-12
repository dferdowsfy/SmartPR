// ============================================================================
// Preparation-PDF generator (Part 14).
//
// Produces a polished, read-only "prepared for submission" PDF from structured
// form data. This is explicitly NOT the official government submission — the
// disclaimer says so on the page — and it is always regenerated from the
// durable structured data, never cached as the only record.
// ============================================================================

import { jsPDF } from "jspdf";
import { evaluateConditions } from "./formConditions.ts";
import type {
  CanonicalAddress,
  CanonicalApplicationData,
  DigitalFormDefinition,
  FormData,
  Lang,
  PartyRecord,
} from "./types.ts";
import { localize } from "./types.ts";
import { getSubmissionDestination, governmentFeeText } from "../submission/pr.ts";

function fmtAddress(addr: CanonicalAddress | undefined): string {
  if (!addr) return "—";
  return [addr.line1, addr.line2, addr.cityOrMunicipality, addr.stateOrTerritory, addr.postalCode, addr.country]
    .filter(Boolean)
    .join(", ");
}

function fmtValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const p = item as PartyRecord;
        return p.fullName || JSON.stringify(item);
      })
      .join("; ");
  }
  if (typeof value === "object") {
    const addr = value as CanonicalAddress;
    if ("line1" in addr) return fmtAddress(addr);
    return JSON.stringify(value);
  }
  return String(value);
}

export function generatePreparationPdf(
  def: DigitalFormDefinition,
  data: FormData,
  canonical: CanonicalApplicationData,
  lang: Lang = "en"
): Blob {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const margin = 18;
  const width = 216 - margin * 2;
  let y = 20;

  const ensure = (needed: number) => {
    if (y + needed <= 260) return;
    doc.addPage();
    y = 20;
  };

  // Header.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(localize(def.title, lang), margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  doc.text(`${def.agency} · ${def.officialFormNumber} · v${def.version}`, margin, y);
  y += 5;
  doc.text(`Entity type: ${canonical.business.entityType}`, margin, y);
  y += 7;

  // "Prepared" banner.
  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(59, 130, 246);
  doc.rect(margin, y, width, 15, "FD");
  doc.setTextColor(30, 64, 175);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("SmartPR preparation summary", margin + 3, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(
    `Complete and sign the official ${def.officialFormNumber} with ${def.agency} before filing.`,
    margin + 3,
    y + 11
  );
  y += 21;

  // Sections.
  for (const section of def.sections) {
    if (!evaluateConditions(section.visibleWhen, data, canonical)) continue;
    ensure(14);
    doc.setTextColor(15, 35, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(localize(section.title, lang), margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const field of section.fields) {
      if (field.type === "heading" || field.type === "statutory_text") continue;
      if (!evaluateConditions(field.visibleWhen, data, canonical)) continue;
      const label = field.label ? localize(field.label, lang) : field.id;
      const rawValue = (data as Record<string, unknown>)[field.id];
      const value = field.sensitive && rawValue ? "Provided securely — not retained" : fmtValue(rawValue);
      const lines = doc.splitTextToSize(`${label}: ${value}`, width - 4);
      ensure(lines.length * 4 + 3);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4 + 2;
    }
    y += 3;
  }

  // Attachments / attestations status.
  if (def.attachments?.length) {
    ensure(12);
    doc.setFont("helvetica", "bold");
    doc.text(localize({ en: "Attachments", es: "Documentos adjuntos" }, lang), margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    for (const att of def.attachments) {
      const present = Boolean((data as Record<string, unknown>)[att.id]);
      const lines = doc.splitTextToSize(`${present ? "[x]" : "[ ]"} ${localize(att.label, lang)}`, width - 4);
      ensure(lines.length * 4 + 2);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4 + 2;
    }
    y += 3;
  }

  // Footer metadata.
  ensure(30);
  const fee = governmentFeeText(def.id, canonical, lang);
  const destination = getSubmissionDestination(def.id);
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, margin + width, y);
  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(75, 85, 99);
  const meta = [
    `Schema version: ${def.version}`,
    `Source document: ${def.sourceDocument}`,
    `Submission method: ${def.submissionMethod}`,
    `Prepared: ${new Date().toLocaleString()}`,
    fee !== null ? `Government filing fee: ${fee} (paid to the agency at submission)` : "",
    destination
      ? `Submitted to: ${localize(destination.agency, lang)} — ${localize(destination.portalName, lang)} (${destination.url})`
      : "",
  ].filter(Boolean);
  for (const line of meta) {
    doc.text(line, margin, y);
    y += 4;
  }
  y += 3;
  const disclaimer = doc.splitTextToSize(
    "Prepared for submission through SmartPR. SmartPR organizes application information but does not submit filings or issue approvals. A prepared application is not an approved permit, license, certificate, or government-issued document.",
    width
  );
  doc.text(disclaimer, margin, y);

  return doc.output("blob");
}
