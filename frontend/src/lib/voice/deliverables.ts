/**
 * SmartPR Voice Phase 3: entitled deliverable generation.
 *
 * Reuses:
 * - the existing billing plan check (canExportDeliverables over the existing
 *   workspace subscription state) — free plans stay blocked
 * - the existing `deliverables` table + `deliverables` storage bucket via the
 *   existing uploadDeliverable() helper
 * - pdf-lib (already a dependency) for the report PDF
 *
 * Safety:
 * - the deliverables row is only written AFTER the storage upload succeeds
 *   (a row never claims a file that isn't there)
 * - generation is deduplicated: an identical deliverable produced in the
 *   last 10 minutes is returned instead of regenerated (network-retry safe)
 * - missing required data returns structured missing fields, never a
 *   hallucinated "completed" package
 */

import { randomUUID } from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import { uploadDeliverable } from "../../app/forms/artifacts/storage";
import {
  getBusinessEvidence,
  getBusinessObligations,
  getBusinessReadiness,
} from "../../app/api/voice/_business";
import { getWorkspacePlanState, PlanGateError } from "../billing/access";
import { canExportDeliverables } from "../billing/entitlements";
import { VoiceAuthError, type Db, type VoiceContext } from "./context";
import { logVoiceAudit } from "./audit";
import { incrementVoiceUsage } from "./usage";

export const VOICE_DELIVERABLE_TYPES = ["readiness_report", "requirements_summary"] as const;
export type VoiceDeliverableType = (typeof VOICE_DELIVERABLE_TYPES)[number];

const DEDUPE_MINUTES = 10;

export interface VoiceBusiness {
  id: string;
  name: string;
  municipality: string | null;
}

function serviceStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Test seam: replaces the real storage upload in unit tests. */
let uploadForTests:
  | ((fileName: string, bytes: Uint8Array) => Promise<{ bucket: string; objectPath: string }>)
  | null = null;
export function setUploadDeliverableForTests(
  fn: ((fileName: string, bytes: Uint8Array) => Promise<{ bucket: string; objectPath: string }>) | null
): void {
  uploadForTests = fn;
}

/** Existing plan gate — do not recreate plan rules here. */
export async function assertVoiceCanGenerateDeliverables(
  db: Db,
  ctx: VoiceContext
): Promise<void> {
  try {
    const state = await getWorkspacePlanState(db, ctx.workspaceId);
    if (!canExportDeliverables(state)) {
      throw new VoiceAuthError(
        "plan_not_entitled",
        "Your current plan does not include generated deliverables.",
        402
      );
    }
  } catch (err) {
    if (err instanceof VoiceAuthError) throw err;
    if (err instanceof PlanGateError) {
      throw new VoiceAuthError("plan_not_entitled", err.message, 402);
    }
    throw err;
  }
}

async function buildReadinessPdf(opts: {
  business: VoiceBusiness;
  type: VoiceDeliverableType;
  generatedAt: Date;
  data: {
    readiness: { overall: number | null };
    obligations: Array<{ name: string; agency: string | null; status: string; due_date: string | null }>;
    missing: Array<{ name: string; agency: string | null; evidence_state: string }>;
    evidence: Array<{ filename: string; review_status: string | null }>;
  };
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const { width } = page.getSize();
  let y = 750;
  const line = (text: string, opts?: { b?: boolean; size?: number; gap?: number; color?: [number, number, number] }) => {
    const size = opts?.size ?? 11;
    page.drawText(text.slice(0, 110), {
      x: 48, y, size,
      font: opts?.b ? bold : font,
      color: rgb(...(opts?.color ?? [0.15, 0.15, 0.15])),
    });
    y -= (opts?.gap ?? 16);
    if (y < 60) { /* single-page report; content is capped below */ y = 60; }
  };

  const title = opts.type === "readiness_report" ? "SmartPR Readiness Report" : "SmartPR Requirements Summary";
  line(title, { b: true, size: 18, gap: 22 });
  line(opts.business.name, { b: true, size: 13 });
  line(`${opts.business.municipality || "Puerto Rico"} — generated ${opts.generatedAt.toLocaleDateString("en-US")}`, { size: 10, color: [0.4, 0.4, 0.4], gap: 22 });
  const r = opts.data.readiness.overall;
  line(`Overall readiness: ${r == null ? "n/a" : `${r}%`}`, { b: true, gap: 20 });

  line("Requirements", { b: true, size: 13, gap: 18 });
  const reqs = opts.data.obligations.slice(0, 40);
  if (!reqs.length) line("No requirements on file for this business.", { size: 10 });
  for (const o of reqs) {
    line(`• ${o.name} — ${o.status}${o.due_date ? ` (due ${o.due_date})` : ""}`, { size: 9, gap: 13 });
  }
  y -= 6;
  line("Missing evidence", { b: true, size: 13, gap: 18 });
  const missing = opts.data.missing.slice(0, 25);
  if (!missing.length) line("Nothing missing — all requirements have evidence.", { size: 10 });
  for (const m of missing) {
    line(`• ${m.name} [${m.evidence_state}]`, { size: 9, gap: 13 });
  }
  y -= 6;
  line("Evidence on file", { b: true, size: 13, gap: 18 });
  const ev = opts.data.evidence.slice(0, 20);
  if (!ev.length) line("No evidence uploaded yet.", { size: 10 });
  for (const e of ev) {
    line(`• ${e.filename} — ${e.review_status ?? "pending review"}`, { size: 9, gap: 13 });
  }
  y -= 10;
  line("Generated by SmartPR Voice. Verify before filing.", { size: 9, color: [0.45, 0.45, 0.45] });

  return doc.save();
}

export interface GeneratedDeliverable {
  deliverableId: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  generatedAt: string;
  deduped: boolean;
}

/**
 * Generate an entitled deliverable for the business. Returns structured
 * missing-data info instead of hallucinating a package.
 */
export async function generateVoiceDeliverable(
  db: Db,
  ctx: VoiceContext,
  business: VoiceBusiness,
  type: VoiceDeliverableType
): Promise<GeneratedDeliverable> {
  await assertVoiceCanGenerateDeliverables(db, ctx);

  // Idempotency: a retry within the dedupe window returns the existing file.
  const recent = await db.query<{
    id: string; filename: string; size_bytes: number | null; generated_at: string;
  }>(
    `SELECT id, filename, size_bytes, generated_at FROM deliverables
      WHERE user_id = $1 AND business_id = $2 AND kind = $3
        AND generated_at > now() - ($4 || ' minutes')::interval
      ORDER BY generated_at DESC LIMIT 1`,
    [ctx.userId, business.id, type, String(DEDUPE_MINUTES)]
  );
  if (recent.rows[0]) {
    const r = recent.rows[0];
    return {
      deliverableId: r.id,
      filename: r.filename,
      kind: type,
      sizeBytes: Number(r.size_bytes ?? 0),
      generatedAt: r.generated_at,
      deduped: true,
    };
  }

  const [obligations, readiness, evidence] = await Promise.all([
    getBusinessObligations(db, business.id),
    getBusinessReadiness(db, business.id),
    getBusinessEvidence(db, business.id),
  ]);
  if (!obligations.length) {
    throw new VoiceAuthError(
      "bad_request",
      "There are no requirements on file for that business yet, so there is nothing to put in a package.",
      400
    );
  }
  const missing = obligations.filter((o) =>
    ["NONE", "FAILED", "NEEDS_REVIEW"].includes(o.evidence_state)
  );

  const generatedAt = new Date();
  const pdf = await buildReadinessPdf({
    business, type, generatedAt,
    data: { readiness, obligations, missing, evidence },
  });

  // Storage upload first — the row is only written once the file exists.
  const deliverableId = randomUUID();
  const filename = `${type}-${business.name.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  let storagePath: string;
  if (uploadForTests) {
    const ref = await uploadForTests(filename, pdf);
    storagePath = `${ref.bucket}/${ref.objectPath}`;
  } else {
    const storage = serviceStorageClient();
    if (!storage) {
      throw new VoiceAuthError(
        "no_database",
        "Deliverable storage is not configured. Please try again later.",
        503
      );
    }
    try {
      const ref = await uploadDeliverable(
        storage,
        { userId: ctx.userId, deliverableId, fileName: filename },
        pdf,
        "application/pdf"
      );
      storagePath = `${ref.bucket}/${ref.objectPath}`;
    } catch (err) {
      throw new VoiceAuthError(
        "no_database",
        "The deliverable could not be stored. Please try again later.",
        503
      );
    }
  }
  await db.query(
    `INSERT INTO deliverables (id, user_id, business_id, submission_id, kind, filename, storage_path, size_bytes)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
    [deliverableId, ctx.userId, business.id, type, filename, storagePath, pdf.length]
  );

  await incrementVoiceUsage(db, ctx.userId, "tool_calls", 1);
  await logVoiceAudit(db, {
    userId: ctx.userId,
    action: "deliverable_generated",
    details: { deliverable_id: deliverableId, business_id: business.id, kind: type },
  });
  return {
    deliverableId,
    filename,
    kind: type,
    sizeBytes: pdf.length,
    generatedAt: generatedAt.toISOString(),
    deduped: false,
  };
}
