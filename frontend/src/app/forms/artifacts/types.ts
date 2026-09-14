// ============================================================================
// SmartPR government-artifact engine — shared types.
//
// The engine in `forms/engine` renders SmartPR's own schema-driven forms. This
// module is about the *government's* artifacts: the real PDF/DOCX files an
// agency publishes, the portals that have no file at all, and the certificates
// an agency issues back. SmartPR never re-draws those documents — it populates
// a working copy of the untouched original.
//
// Kept free of runtime-only TS features so node:test can run it with
// `--experimental-strip-types`.
// ============================================================================

/**
 * What kind of thing the government requirement is satisfied with.
 *
 * `genericized_municipal_template` is deliberately its own class: a municipal
 * layout whose municipality-specific wording was removed. It is a development
 * and data-modelling aid — never an official filing form for any municipality.
 */
export type ArtifactType =
  | "official_pdf_form"
  | "official_docx_form"
  | "genericized_municipal_template"
  | "portal_submission"
  | "issued_certificate"
  | "supporting_evidence"
  | "smartpr_generated";

/** How SmartPR writes user data onto the artifact. */
export type PopulationMethod =
  | "acroform"
  | "pdf_overlay"
  | "docx_merge"
  | "structured_portal_data"
  | "none";

/** Where the finished filing actually goes. */
export type SubmissionChannel =
  | "agency_portal"
  | "in_person"
  | "mail"
  | "email"
  | "municipal_office"
  | "not_yet_determined";

/** Jurisdictional reach of the artifact. */
export type ArtifactScope = "federal" | "statewide" | "municipality_specific";

/**
 * Provenance of the local file backing a template.
 *
 * `official_source` — byte-for-byte the agency's published file.
 * `genericized_working_copy` — an official layout with municipality-specific
 *   wording removed; usable for field mapping, never presentable as official.
 * `pending_source` — SmartPR knows the artifact exists but has no file yet.
 * `smartpr_generated` — SmartPR generates this artifact from user data at
 *   preparation time (worksheet, letter template). There is no agency file,
 *   and it must never be presented as an official government form.
 */
export type TemplateSourceStatus =
  | "official_source"
  | "genericized_working_copy"
  | "pending_source"
  | "smartpr_generated";

/** A template in the SmartPR library (one row per form code + revision). */
export interface TemplateDescriptor {
  /** Stable short code, e.g. "CORPREG01", "SS4", "PA02". */
  formCode: string;
  title: string;
  agency: string;
  /** Only set for municipality_specific artifacts that are municipality-bound. */
  municipality?: string;
  scope: ArtifactScope;
  artifactType: ArtifactType;
  populationMethod: PopulationMethod;
  submissionChannel: SubmissionChannel;
  sourceStatus: TemplateSourceStatus;
  /** Agency revision string printed on the artifact, when known. */
  revision?: string;
  officialSourceUrl?: string;
  /** Path of the untouched original, relative to the repository root. */
  sourceFile?: string;
  /** Supabase Storage object path of the canonical original. */
  storagePath?: string;
  /** SHA-256 of the canonical original, "sha256:<hex>". */
  checksum?: string;
  /** Last time a human confirmed this artifact against the agency source. */
  lastVerifiedAt?: string;
  /** Canonical SmartPR requirement this artifact satisfies. */
  requirementCode: string;
  /** Operator-facing constraints; surfaced verbatim in admin UI. */
  usageNotes?: string[];
}

// ---------------------------------------------------------------------------
// PDF inspection
// ---------------------------------------------------------------------------

export type PdfFieldType =
  | "text"
  | "checkbox"
  | "radio_group"
  | "dropdown"
  | "option_list"
  | "button"
  | "signature"
  | "unknown";

export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One native AcroForm field as found in the source PDF. */
export interface AcroFieldRecord {
  name: string;
  type: PdfFieldType;
  /** 1-indexed page of the first widget annotation, when resolvable. */
  page?: number;
  /** Bounding rect of the first widget, in PDF user space (origin bottom-left). */
  rect?: FieldRect;
  defaultValue?: string;
  currentValue?: string;
  options?: string[];
  readOnly?: boolean;
  maxLength?: number;
}

export interface PdfInspectionReport {
  formCode: string;
  sourceFile: string;
  checksum: string;
  pageCount: number;
  pageSizes: { page: number; width: number; height: number }[];
  hasAcroForm: boolean;
  fieldCount: number;
  fields: AcroFieldRecord[];
  inspectedAt: string;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/**
 * Value shaping applied between the canonical profile and the government field
 * (a municipal form that splits a date into Mes/Día/Año needs three of these).
 */
export type MappingTransform =
  | "none"
  | "upper"
  | "yes_no"
  | "si_no"
  | "date_year"
  | "date_month"
  | "date_day"
  | "month_number"
  | "integer"
  | "currency"
  | "first_name"
  | "last_name";

/** Placement of a value on a page for `pdf_overlay` population. */
export interface OverlayPlacement {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  /** Wrap long values across this many lines inside the box. */
  maxLines?: number;
  /** Baseline-to-baseline distance when wrapping; defaults to fontSize * 1.15. */
  lineHeight?: number;
  align?: "left" | "center";
}

/**
 * Guard for values that are only written when the profile says so — the "X" in
 * a term-of-existence box, or a license checkbox on SC 2309.
 */
export interface WriteCondition {
  canonicalField: string;
  /** Written when the canonical value (stringified) is one of these. */
  equalsAny: string[];
}

/**
 * Who is responsible for a field's value — and, just as importantly, whether
 * SmartPR is ever allowed to write one in.
 *
 *   applicant        — the filer's own answer (may be prefilled, stays editable).
 *   smartpr_derived  — computed by SmartPR from other answers (e.g. a split date part).
 *   calculated       — a deterministic result of a formula defined on the form itself.
 *   government_only  — an "USO OFICIAL" / agency-processing box. Never written by
 *                       SmartPR under any circumstance, even if a mapping exists.
 *   signature        — the filer's own wet/e-signature line. Never written.
 *   notary           — an oath/affidavit/notarization block completed by a notary
 *                       or administering official at the moment of signing. Never
 *                       written; SmartPR must not misrepresent this as done.
 *
 * `government_only` / `signature` / `notary` are a hard backstop enforced in
 * population.ts regardless of what `canonicalField`/`constantValue` say — a
 * mapping mistake here must never leak a value onto an official-use box.
 */
export type FieldOwnership =
  | "applicant"
  | "smartpr_derived"
  | "calculated"
  | "government_only"
  | "signature"
  | "notary";

export interface FieldMapping {
  /**
   * Native AcroForm field name, or — for overlay forms, which have no native
   * fields — a stable synthetic id for this blank on the page.
   */
  pdfField: string;
  pdfFieldType?: PdfFieldType;
  page?: number;
  rect?: FieldRect;
  defaultValue?: string;
  /** Canonical field id, e.g. "business.legal_name". Null = intentionally unmapped. */
  canonicalField: string | null;
  transform?: MappingTransform;
  /** Literal written for fields the profile can never supply (e.g. a checkbox export value). */
  constantValue?: string;
  /** Only write this field when the condition holds. */
  writeWhen?: WriteCondition;
  /** Mapping confidence 0–1. Anything below REVIEW_THRESHOLD needs a human. */
  confidence: number;
  /** Set true only by a human who checked the mapping against the real form. */
  reviewed: boolean;
  reviewNote?: string;
  /** Placement for overlay population. */
  placement?: OverlayPlacement;
  /** Never auto-populated; the user must supply it in the artifact itself. */
  sensitive?: boolean;
  /** Who owns this value. Omitted only on mappings predating this field — see
   * population.ts's `resolveOwnership` for the inferred default in that case. */
  ownership?: FieldOwnership;
}

/** The persisted `form-mappings/<FORM_CODE>.json` document. */
export interface FormMappingDocument {
  formCode: string;
  sourceFile: string | null;
  artifactType: ArtifactType;
  populationMethod: PopulationMethod;
  templateChecksum: string | null;
  /** Revision the coordinates/field names were captured against. */
  templateRevision?: string;
  pageCount: number;
  hasAcroForm: boolean;
  inspectedAt: string | null;
  status: "mapped" | "pending_source";
  notes?: string[];
  fields: FieldMapping[];
}

// ---------------------------------------------------------------------------
// Population results
// ---------------------------------------------------------------------------

export interface PopulatedFieldRecord {
  pdfField: string;
  canonicalField: string | null;
  value: string;
}

export interface UnansweredFieldRecord {
  pdfField: string;
  canonicalField: string | null;
  page?: number;
  reason:
    | "no_canonical_mapping"
    | "no_value_in_profile"
    | "requires_user_entry"
    /** ownership: "government_only" — an agency-processing box; never SmartPR's to fill. */
    | "government_only"
    /** ownership: "signature" — the filer's own signature line. */
    | "signature_required"
    /** ownership: "notary" — an oath/affidavit block completed at signing. */
    | "notary_required";
  label?: string;
}

export interface PopulationResult {
  formCode: string;
  populationMethod: PopulationMethod;
  /** Bytes of the populated WORKING COPY. The template is never modified. */
  bytes: Uint8Array;
  populated: PopulatedFieldRecord[];
  unanswered: UnansweredFieldRecord[];
  /** Checksum of the source template the copy was made from. */
  templateChecksum: string;
  generatedAt: string;
}
