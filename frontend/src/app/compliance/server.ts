import { randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { ACTIVE_JURISDICTION } from "../jurisdictions";
import {
  KB,
  INTAKE_INDUSTRIES,
  computeRequirementsFromSnapshot,
  type UIRequirement,
} from "../kb";
import { resolveIntakeFacts } from "../ai/intake/relationships";
import { entityTypeFromLegacyStructure } from "../forms/engine/intake";
import { normalizeEntityFormationRequirements } from "../forms/engine/requirementAugment";
import type { KnowledgeBase } from "../rulesEngine";
import { REMINDER_WINDOWS_DAYS, subtractDays } from "./dates";
import type { ObligationBlueprint } from "./types";

type Db = Pool | PoolClient;

interface UserLike {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

interface SnapshotShape extends KnowledgeBase {
  docMeta?: {
    recommended?: string[];
    legacyCode?: Record<string, string>;
  };
  extensions?: {
    renewals?: Record<string, unknown>[];
  };
  meta?: { version?: number };
}

export async function ensureUserWorkspace(db: Db, user: UserLike): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `SELECT w.id
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = $1 AND w.archived_at IS NULL
      ORDER BY CASE wm.role WHEN 'OWNER' THEN 0 ELSE 1 END, w.created_at
      LIMIT 1`,
    [user.id]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const workspaceId = randomUUID();
  const professionalRole = user.user_metadata?.professional_role;
  const workspaceKind = ["gestor", "cpa", "permitting", "attorney"].includes(
    typeof professionalRole === "string" ? professionalRole : ""
  ) ? "PROFESSIONAL" : "INDIVIDUAL";
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.email ? `${user.email.split("@")[0]}'s workspace` : "My SmartPR Workspace");
  await db.query(
    `INSERT INTO workspaces (id, owner_user_id, name, kind) VALUES ($1,$2,$3,$4)`,
    [workspaceId, user.id, displayName, workspaceKind]
  );
  await db.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'OWNER')
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [workspaceId, user.id]
  );
  // Adopt legacy businesses without changing their existing user ownership.
  await db.query(
    `UPDATE businesses SET workspace_id = $1, updated_at = now()
      WHERE user_id = $2 AND workspace_id IS NULL`,
    [workspaceId, user.id]
  );
  return workspaceId;
}

export async function userCanAccessBusiness(db: Db, userId: string, businessId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
       FROM businesses b
       LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE b.id = $1 AND b.archived = false AND (b.user_id = $2 OR wm.user_id IS NOT NULL)
      LIMIT 1`,
    [businessId, userId]
  );
  return Boolean(result.rows[0]);
}

async function loadPublishedSnapshot(db: Db): Promise<SnapshotShape | null> {
  try {
    const row = (
      await db.query(`SELECT kb_json FROM rk_kb_snapshots WHERE is_active LIMIT 1`)
    ).rows[0] as { kb_json?: SnapshotShape } | undefined;
    const kb = row?.kb_json;
    if (
      kb && Array.isArray(kb.municipalities) && Array.isArray(kb.businessTypes) &&
      Array.isArray(kb.questions) && Array.isArray(kb.documents) && Array.isArray(kb.rules)
    ) return kb;
  } catch {
    // The bundled deterministic knowledge pack is the established fallback.
  }
  return null;
}

export async function renewalMetadataForDocuments(
  db: Db,
  documentIds: string[]
): Promise<Map<string, { frequencyMonths: number; reference: string | null; graphEntityId: string | null }>> {
  const wanted = new Set(documentIds);
  const out = new Map<string, { frequencyMonths: number; reference: string | null; graphEntityId: string | null }>();
  const published = await loadPublishedSnapshot(db);
  let renewals = published?.extensions?.renewals ?? [];
  if (!renewals.length) {
    try {
      renewals = (await db.query(
        `SELECT data || jsonb_build_object('id', entity_id) AS renewal
           FROM rk_nodes WHERE node_type='renewal' AND status='active'`
      )).rows.map((row) => row.renewal as Record<string, unknown>);
    } catch {
      renewals = [];
    }
  }
  for (const renewal of renewals) {
    const documentId = typeof renewal.document_id === "string" ? renewal.document_id : null;
    const frequency = typeof renewal.frequency_months === "number" ? renewal.frequency_months : Number(renewal.frequency_months);
    if (!documentId || !wanted.has(documentId) || !Number.isInteger(frequency) || frequency <= 0) continue;
    out.set(documentId, {
      frequencyMonths: frequency,
      reference: typeof renewal.citation === "string" ? renewal.citation
        : typeof renewal.source_reference === "string" ? renewal.source_reference : null,
      graphEntityId: typeof renewal.id === "string" ? renewal.id : null,
    });
  }
  return out;
}

export async function determineObligations(
  db: Db,
  profile: Record<string, unknown>,
  answers: Record<string, unknown> = {}
): Promise<{ obligations: ObligationBlueprint[]; knowledgeSource: "PUBLISHED_SNAPSHOT" | "BUNDLED_KB" }> {
  const published = await loadPublishedSnapshot(db);
  const snapshot = published ?? (ACTIVE_JURISDICTION.kb as SnapshotShape);
  // F10: the server runs the SAME deterministic pipeline as the intake UI —
  // relationship-resolved facts, entity type, engine, classifier, formation
  // normalization — so persisted obligations match what the user sees.
  const entityType = entityTypeFromLegacyStructure(
    (profile as { business_structure?: string }).business_structure
  );
  const resolved = resolveIntakeFacts(
    { profile: profile as Record<string, unknown>, answers: answers as Record<string, unknown> },
    { kb: KB, allowedIndustries: INTAKE_INDUSTRIES }
  ).questionValues;
  const classified = computeRequirementsFromSnapshot(
    snapshot as KnowledgeBase,
    profile as Parameters<typeof computeRequirementsFromSnapshot>[1],
    answers as Record<string, unknown>,
    resolved,
    {
      entityType,
      recommendedIds: new Set(
        published ? (snapshot.docMeta?.recommended ?? []) : ACTIVE_JURISDICTION.docMappings.recommended
      ),
      legacyCode: published
        ? (snapshot.docMeta?.legacyCode as Record<string, string> | undefined)
        : undefined,
    }
  );
  // Formation certificates implied by the entity type, exactly as the UI adds
  // them; exclusivity is enforced inside (no resurrected wrong certificate).
  const normalized = normalizeEntityFormationRequirements<UIRequirement>(
    entityType,
    classified,
    (def, et) => ({
      code: def.code,
      name: def.name,
      mandatory: true,
      status: "pending",
      agency: "Department of State",
      reason: def.reason,
      document_id: def.document_id,
      category: "formation",
      source_rule: undefined,
      applicability: "required",
      kind: "government_application",
      stage: "entity_formation",
      triggerFacts: [`entityType:${et}`],
      acceptsOfficialUpload: true,
    })
  ).filter((r) => r.applicability !== "not_applicable");
  const renewals = snapshot.extensions?.renewals ?? [];
  const renewalByDocument = new Map<string, Record<string, unknown>>();
  for (const renewal of renewals) {
    const documentId = typeof renewal.document_id === "string" ? renewal.document_id : null;
    if (documentId) renewalByDocument.set(documentId, renewal);
  }

  const obligations = normalized.map<ObligationBlueprint>((requirement) => {
    const renewal = renewalByDocument.get(requirement.document_id ?? "");
    const rawFrequency = renewal?.frequency_months;
    const frequency = typeof rawFrequency === "number" && Number.isInteger(rawFrequency) && rawFrequency > 0
      ? rawFrequency
      : null;
    const renewalReference =
      (typeof renewal?.citation === "string" && renewal.citation) ||
      (typeof renewal?.source_reference === "string" && renewal.source_reference) ||
      null;
    return {
      requirementId: requirement.document_id ?? "",
      graphEntityId: typeof renewal?.id === "string" ? renewal.id : null,
      name: requirement.name,
      agency: requirement.agency,
      mandatory: requirement.mandatory,
      source: "REGULATORY_GRAPH",
      sourceReference: requirement.source_rule ?? requirement.triggerFacts?.[0] ?? requirement.document_id ?? "",
      renewalFrequencyMonths: frequency,
      renewalReference,
    };
  });
  return { obligations, knowledgeSource: published ? "PUBLISHED_SNAPSHOT" : "BUNDLED_KB" };
}

export async function scheduleObligationNotifications(
  db: Db,
  input: {
    userId: string;
    workspaceId: string | null;
    businessId: string;
    businessName: string;
    obligationId: string;
    obligationName: string;
    dueDate: string;
  }
): Promise<void> {
  await db.query(
    `UPDATE notifications SET status = 'CANCELLED'
      WHERE obligation_id = $1 AND status = 'PENDING'`,
    [input.obligationId]
  );
  for (const days of REMINDER_WINDOWS_DAYS) {
    const type = days === 0 ? "OVERDUE_OR_DUE" : `RENEWAL_${days}_DAY`;
    const message = days === 0
      ? `${input.obligationName} for ${input.businessName} is due.`
      : `${input.obligationName} for ${input.businessName} is due in ${days} days.`;
    const scheduledFor = `${subtractDays(input.dueDate, days)}T09:00:00.000Z`;
    await db.query(
      `INSERT INTO notifications
         (id, user_id, workspace_id, business_id, obligation_id, type, scheduled_for, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (obligation_id, type, scheduled_for) DO UPDATE SET
         status = 'PENDING', message = EXCLUDED.message`,
      [randomUUID(), input.userId, input.workspaceId, input.businessId, input.obligationId, type, scheduledFor, message]
    );
  }
}
