/**
 * Filing readiness for the Clara chat: which supporting documents SmartPR has
 * on file, and for each filing how many of its readiness items are in place.
 *
 * Built only from real records — Evidence Locker rows, the Business Passport
 * and each filing config's evidence tags. Nothing is marked "Complete"
 * unless there is a record behind it. Labels only; never field values.
 */
import type { FilingGroup, FilingOption } from "./agencyActions";
import { nonSensitiveMissingItems } from "./agencyActions";
import { AGENCY_FILING_CONFIGS } from "./filingTypes";

export type DocumentStatus = "verified" | "on_file" | "needs_attention";

export interface OnFileDocument {
  id: string;
  label_en: string;
  label_es: string;
  status: DocumentStatus;
}

export interface ReadinessItem {
  id: string;
  label_en: string;
  label_es: string;
  ready: boolean;
}

export interface FilingReadiness {
  /** FilingOption.id + obligation id (unique per card). */
  key: string;
  ready: number;
  total: number;
  items: ReadinessItem[];
}

export interface FilingReadinessSummary {
  documents: OnFileDocument[];
  filings: FilingReadiness[];
}

export interface EvidenceRowLike {
  document_type?: string | null;
  original_filename?: string | null;
  review_status: string;
  requirement_tags?: string[] | null;
}

export interface ObligationLabelLike {
  requirement_id?: string | null;
  name: string;
}

export const filingReadinessKey = (f: Pick<FilingOption, "id" | "obligation_id">) => `${f.id}:${f.obligation_id}`;

/** Readable fallback for a DOC_ tag with no obligation name ("DOC_PHOTO_ID" → "Photo ID"). */
export function prettifyTag(tag: string): string {
  const words = tag.replace(/^DOC_/i, "").split(/[_\s]+/).filter(Boolean);
  const ACRONYMS = new Set(["ID", "EIN", "SSN", "CRIM", "LLC", "IRS", "SURI", "CRIM", "OGPE", "PDF", "DBA"]);
  return words
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function tagLabel(tag: string, names: Map<string, string>): string {
  return names.get(tag) ?? prettifyTag(tag);
}

const STATUS_RANK: Record<DocumentStatus, number> = { verified: 0, on_file: 1, needs_attention: 2 };

function documentStatus(review: string): DocumentStatus | null {
  if (review === "REJECTED") return null;
  if (review === "VERIFIED") return "verified";
  if (review === "NEEDS_REVIEW") return "needs_attention";
  return "on_file"; // UPLOADED / PROCESSING
}

export function buildFilingReadiness(input: {
  groups: FilingGroup[];
  evidence: EvidenceRowLike[];
  obligations: ObligationLabelLike[];
  passport: { filled: number; total: number } | null;
}): FilingReadinessSummary {
  const names = new Map<string, string>();
  for (const o of input.obligations) if (o.requirement_id && o.name) names.set(o.requirement_id, o.name);

  // Documents on file: one row per tag (best status wins); untagged files by name.
  const byKey = new Map<string, OnFileDocument>();
  const tagsOnFile = new Set<string>();
  for (const e of input.evidence) {
    const status = documentStatus(e.review_status);
    if (!status) continue;
    const tags = (e.requirement_tags ?? []).filter(Boolean);
    for (const t of tags) tagsOnFile.add(t);
    const key = tags[0] ?? `file:${e.document_type || e.original_filename || "document"}`;
    const label = tags[0] ? tagLabel(tags[0], names) : e.document_type || e.original_filename || "Document";
    const prev = byKey.get(key);
    if (!prev || STATUS_RANK[status] < STATUS_RANK[prev.status]) {
      byKey.set(key, { id: key, label_en: label, label_es: label, status });
    }
  }
  const documents = [...byKey.values()];
  if (input.passport && input.passport.total > 0) {
    const complete = input.passport.filled >= input.passport.total;
    documents.push({
      id: "business_passport",
      label_en: complete ? "Business Passport" : `Business Passport (${Math.round((input.passport.filled / input.passport.total) * 100)}%)`,
      label_es: complete ? "Pasaporte comercial" : `Pasaporte comercial (${Math.round((input.passport.filled / input.passport.total) * 100)}%)`,
      status: complete ? "verified" : "needs_attention",
    });
  }
  documents.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

  const filings: FilingReadiness[] = [];
  for (const group of input.groups) {
    for (const f of group.filings) {
      if (!f.action || !f.supported) continue;
      const config = AGENCY_FILING_CONFIGS.find((c) => c.id === f.action!.filing_type);
      const passportMissing = nonSensitiveMissingItems(f.action).length;
      const items: ReadinessItem[] = [
        {
          id: "business_passport",
          label_en: passportMissing === 0 ? "Business Passport details" : `Business Passport details (${passportMissing} missing)`,
          label_es: passportMissing === 0 ? "Datos del Pasaporte comercial" : `Datos del Pasaporte comercial (faltan ${passportMissing})`,
          ready: passportMissing === 0,
        },
      ];
      for (const tag of config?.evidenceTags ?? []) {
        const label = tagLabel(tag, names);
        items.push({ id: tag, label_en: label, label_es: label, ready: tagsOnFile.has(tag) });
      }
      filings.push({
        key: filingReadinessKey(f),
        ready: items.filter((i) => i.ready).length,
        total: items.length,
        items,
      });
    }
  }
  return { documents, filings };
}
