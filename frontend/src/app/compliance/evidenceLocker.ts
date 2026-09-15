// Evidence locker — upload once, tag with requirement codes, reuse across
// obligations and filing packages. Extends the existing `evidence` table /
// Supabase `evidence` bucket; does not invent a second file store.

export interface LockerEvidence {
  id: string;
  original_filename: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  document_type?: string | null;
  review_status?: string | null;
  obligation_id?: string | null;
  requirement_tags?: string[] | null;
  created_at?: string | null;
  storage_path?: string | null;
}

export interface ObligationRef {
  id: string;
  requirement_id?: string | null;
  name?: string | null;
  status?: string | null;
}

export interface PackageEvidenceEntry {
  evidenceId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** Path inside the ZIP under evidence/ */
  zipPath: string;
  /** DOC_ / requirement codes this file satisfies in the package */
  requirementCodes: string[];
  /** Obligation ids this file is linked to (direct or via tag) */
  obligationIds: string[];
  storagePath: string | null;
  /** Why it was included */
  inclusionReason: "obligation_link" | "requirement_tag" | "both";
}

const DOC_CODE_RE = /^DOC_[A-Z0-9_]{1,80}$/;

/** Normalize a single requirement / document code for storage and matching. */
export function normalizeRequirementTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Reject path-like or empty input before scrubbing.
  if (/[\/\.]/.test(raw) || raw.includes("..")) return null;
  const trimmed = raw.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!trimmed || !DOC_CODE_RE.test(trimmed)) return null;
  return trimmed;
}

/** Dedupe + normalize a tag list. Invalid entries are dropped. */
export function normalizeRequirementTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const tag = normalizeRequirementTag(item);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((t) => sb.has(t));
}

/** Merge tags (normalized), preserving order of first occurrence. */
export function mergeRequirementTags(...lists: unknown[]): string[] {
  return normalizeRequirementTags(
    lists.flatMap((list) => {
      if (Array.isArray(list)) return list;
      if (typeof list === "string") return [list];
      return [];
    })
  );
}

/**
 * True when this locker file satisfies an obligation: either linked via
 * obligation_id, or tagged with the obligation's requirement_id / DOC_ code.
 */
export function evidenceSatisfiesObligation(
  evidence: LockerEvidence,
  obligation: ObligationRef
): boolean {
  if (evidence.obligation_id && evidence.obligation_id === obligation.id) return true;
  const code = normalizeRequirementTag(obligation.requirement_id);
  if (!code) return false;
  const tags = normalizeRequirementTags(evidence.requirement_tags);
  return tags.includes(code);
}

/** Evidence rows that satisfy a given obligation (for UI / status). */
export function evidenceForObligation(
  evidence: LockerEvidence[],
  obligation: ObligationRef
): LockerEvidence[] {
  return evidence.filter((row) => evidenceSatisfiesObligation(row, obligation));
}

/**
 * Select locker files to include in a filing / submission package ZIP.
 * Includes files linked to any listed obligation OR tagged with any of those
 * obligations' requirement codes. One physical file appears once even when it
 * satisfies multiple requirements.
 */
export function selectPackageEvidence(
  evidence: LockerEvidence[],
  obligations: ObligationRef[]
): PackageEvidenceEntry[] {
  const oblById = new Map(obligations.map((o) => [o.id, o]));
  const codes = new Set(
    obligations
      .map((o) => normalizeRequirementTag(o.requirement_id))
      .filter((c): c is string => Boolean(c))
  );

  const entries: PackageEvidenceEntry[] = [];
  const usedNames = new Set<string>();

  for (const row of evidence) {
    const tags = normalizeRequirementTags(row.requirement_tags);
    const linkedObligations = obligations.filter((o) => evidenceSatisfiesObligation(row, o));
    if (linkedObligations.length === 0) continue;

    const viaLink = Boolean(row.obligation_id && oblById.has(row.obligation_id));
    const viaTag = tags.some((t) => codes.has(t));
    const inclusionReason: PackageEvidenceEntry["inclusionReason"] =
      viaLink && viaTag ? "both" : viaLink ? "obligation_link" : "requirement_tag";

    const requirementCodes = Array.from(
      new Set([
        ...tags,
        ...linkedObligations
          .map((o) => normalizeRequirementTag(o.requirement_id))
          .filter((c): c is string => Boolean(c)),
      ])
    );

    const base = safeZipFilename(row.original_filename || "document");
    let filename = base;
    let n = 2;
    while (usedNames.has(filename.toLowerCase())) {
      filename = `${stripExt(base)}-${n}${extOf(base)}`;
      n += 1;
    }
    usedNames.add(filename.toLowerCase());

    entries.push({
      evidenceId: row.id,
      filename,
      mimeType: row.mime_type ?? null,
      sizeBytes: row.size_bytes ?? null,
      zipPath: `evidence/${filename}`,
      requirementCodes,
      obligationIds: linkedObligations.map((o) => o.id),
      storagePath: row.storage_path ?? null,
      inclusionReason,
    });
  }

  return entries.sort((a, b) => a.filename.localeCompare(b.filename));
}

/** Manifest fragment for package ZIP / JSON deliverables. */
export function packageEvidenceManifest(entries: PackageEvidenceEntry[]) {
  return {
    count: entries.length,
    files: entries.map((e) => ({
      evidenceId: e.evidenceId,
      filename: e.filename,
      zipPath: e.zipPath,
      requirementCodes: e.requirementCodes,
      obligationIds: e.obligationIds,
      inclusionReason: e.inclusionReason,
      mimeType: e.mimeType,
      sizeBytes: e.sizeBytes,
    })),
  };
}

function safeZipFilename(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim().slice(-140);
  return cleaned || "document";
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}
