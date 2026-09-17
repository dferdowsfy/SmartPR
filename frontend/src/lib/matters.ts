/**
 * Shared matter (project) creation service.
 *
 * Extracted verbatim from app/api/matters/route.ts so the web flow and the
 * voice flow create matters through one code path: same validation, same
 * columns, same DRAFT status semantics.
 */

import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { DUE_DATE_SOURCES, MATTER_TYPES, type DueDateSource, type MatterType } from "../app/compliance/types";
import { validDateOnly } from "../app/compliance/dates";

export interface CreateMatterInput {
  businessId: string;
  workspaceId: string;
  userId: string;
  matterType?: string;
  title?: string | null;
  dueDate?: string | null;
  dueDateSource?: string | null;
  sourceReference?: string | null;
}

export interface CreatedMatter {
  matterId: string;
  matterType: MatterType;
  title: string;
}

export function defaultMatterTitle(type: MatterType): string {
  return type
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

export function coerceMatterType(raw: unknown): MatterType {
  return typeof raw === "string" && (MATTER_TYPES as readonly string[]).includes(raw)
    ? (raw as MatterType)
    : "OTHER";
}

/**
 * Insert a DRAFT matter. The caller must have already verified business
 * access; this function performs no authorization.
 */
export async function createMatterRecord(
  client: PoolClient,
  input: CreateMatterInput
): Promise<CreatedMatter> {
  const matterType = coerceMatterType(input.matterType);
  const dueDate = input.dueDate ? validDateOnly(input.dueDate) : null;
  if (input.dueDate && !dueDate) {
    throw new Error("Due date must use YYYY-MM-DD.");
  }
  const dueSource: DueDateSource =
    dueDate && input.dueDateSource && (DUE_DATE_SOURCES as readonly string[]).includes(input.dueDateSource)
      ? (input.dueDateSource as DueDateSource)
      : "UNKNOWN";
  if (dueDate && dueSource === "UNKNOWN") {
    throw new Error("A due-date source is required whenever a date is entered.");
  }
  const title = (input.title || "").trim() || defaultMatterTitle(matterType);
  const matterId = randomUUID();
  await client.query(
    `INSERT INTO matters
       (id, business_id, workspace_id, user_id, matter_type, title, status, due_date,
        due_date_source, source_reference, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,
             CASE WHEN $8 <> 'UNKNOWN' THEN now() ELSE NULL END)`,
    [matterId, input.businessId, input.workspaceId, input.userId, matterType, title, dueDate, dueSource, input.sourceReference ?? null]
  );
  return { matterId, matterType, title };
}
