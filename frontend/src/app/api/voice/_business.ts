// Shared business-data helpers for the authenticated voice API (v1).
// Reuses the existing obligations/evidence/readiness model — the same rows
// the SmartPR dashboard reads — so voice answers match what the user sees.

import {
  deriveObligationStatus,
  nextActionForStatus,
  validDateOnly,
} from "../../compliance/dates";
import type { Db } from "../../../lib/voice/context";

export interface VoiceObligation {
  id: string;
  name: string;
  requirement_id: string | null;
  agency: string | null;
  status: string;
  evidence_state: "NONE" | "VERIFIED" | "NEEDS_REVIEW" | "FAILED";
  due_date: string | null;
  next_action: string | null;
  matter_title: string | null;
}

interface ObligationRow {
  id: string;
  name: string;
  requirement_id: string | null;
  agency: string | null;
  status: string | null;
  due_date: string | null;
  next_action: string | null;
  renewal_frequency_months: number | null;
  matter_title: string | null;
  evidence_state: "NONE" | "VERIFIED" | "NEEDS_REVIEW" | "FAILED";
}

export async function getBusinessObligations(
  db: Db,
  businessId: string
): Promise<VoiceObligation[]> {
  const { rows } = await db.query<ObligationRow>(
    `SELECT o.id, o.name, o.requirement_id, o.agency, o.status,
            o.due_date::text AS due_date, o.next_action,
            o.renewal_frequency_months, m.title AS matter_title,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM evidence e
                 WHERE e.business_id = o.business_id
                   AND (e.obligation_id = o.id
                        OR (o.requirement_id IS NOT NULL AND o.requirement_id = ANY(e.requirement_tags)))
                   AND e.review_status = 'VERIFIED'
              ) THEN 'VERIFIED'
              WHEN EXISTS (
                SELECT 1 FROM evidence e
                 WHERE e.business_id = o.business_id
                   AND (e.obligation_id = o.id
                        OR (o.requirement_id IS NOT NULL AND o.requirement_id = ANY(e.requirement_tags)))
                   AND e.review_status = 'NEEDS_REVIEW'
              ) THEN 'NEEDS_REVIEW'
              WHEN EXISTS (
                SELECT 1 FROM evidence e
                 WHERE e.business_id = o.business_id
                   AND (e.obligation_id = o.id
                        OR (o.requirement_id IS NOT NULL AND o.requirement_id = ANY(e.requirement_tags)))
              ) THEN 'FAILED'
              ELSE 'NONE' END AS evidence_state
       FROM obligations o LEFT JOIN matters m ON m.id = o.matter_id
      WHERE o.business_id = $1 AND o.status <> 'ARCHIVED'
      ORDER BY o.due_date NULLS LAST, o.created_at DESC`,
    [businessId]
  );
  return rows.map((row) => {
    const dueDate = validDateOnly(row.due_date);
    const status = deriveObligationStatus({
      currentStatus: row.status,
      dueDate,
      evidenceState: row.evidence_state,
      expectsRenewal: Boolean(row.renewal_frequency_months || dueDate),
    });
    return {
      id: row.id,
      name: row.name,
      requirement_id: row.requirement_id,
      agency: row.agency,
      status,
      evidence_state: row.evidence_state,
      due_date: dueDate,
      next_action: row.next_action || nextActionForStatus(status),
      matter_title: row.matter_title,
    };
  });
}

export interface VoiceEvidenceItem {
  id: string;
  filename: string;
  document_type: string | null;
  review_status: string | null;
  obligation_name: string | null;
  created_at: string;
}

export async function getBusinessEvidence(
  db: Db,
  businessId: string
): Promise<VoiceEvidenceItem[]> {
  const { rows } = await db.query<{
    id: string;
    original_filename: string;
    document_type: string | null;
    review_status: string | null;
    obligation_name: string | null;
    created_at: string;
  }>(
    `SELECT e.id, e.original_filename, e.document_type, e.review_status,
            o.name AS obligation_name, e.created_at::text AS created_at
       FROM evidence e LEFT JOIN obligations o ON o.id = e.obligation_id
      WHERE e.business_id = $1
      ORDER BY e.created_at DESC`,
    [businessId]
  );
  return rows.map((row) => ({
    id: row.id,
    filename: row.original_filename,
    document_type: row.document_type,
    review_status: row.review_status,
    obligation_name: row.obligation_name,
    created_at: row.created_at,
  }));
}

export interface VoiceReadiness {
  overall: number | null;
  matters: Array<{ id: string; title: string; status: string; score: number | null }>;
}

export async function getBusinessReadiness(
  db: Db,
  businessId: string
): Promise<VoiceReadiness> {
  const { rows } = await db.query<{
    id: string;
    title: string;
    status: string;
    readiness_score: number | null;
  }>(
    `SELECT id, title, status, readiness_score
       FROM matters WHERE business_id = $1 AND status NOT IN ('ARCHIVED')
       ORDER BY opened_at DESC`,
    [businessId]
  );
  const scored = rows.filter((row) => row.readiness_score != null);
  const overall = scored.length
    ? Math.round(scored.reduce((sum, row) => sum + Number(row.readiness_score), 0) / scored.length)
    : null;
  return {
    overall,
    matters: rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      score: row.readiness_score != null ? Number(row.readiness_score) : null,
    })),
  };
}

export interface VoiceNotification {
  id: string;
  type: string | null;
  scheduled_for: string | null;
  status: string | null;
  message: string | null;
}

export async function getBusinessNotifications(
  db: Db,
  businessId: string,
  userId: string
): Promise<VoiceNotification[]> {
  const { rows } = await db.query<{
    id: string;
    type: string | null;
    scheduled_for: string | null;
    status: string | null;
    message: string | null;
  }>(
    `SELECT id, type, scheduled_for::text AS scheduled_for, status, message
       FROM notifications WHERE business_id = $1 AND user_id = $2
       ORDER BY scheduled_for DESC LIMIT 50`,
    [businessId, userId]
  );
  return rows;
}
