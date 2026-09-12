// ============================================================================
// Publication batches (SERVER ONLY) — the ONLY path to live regulatory state.
//
// Workflow: Draft → Approved → (Scheduled) → Published → (Rolled back)
//  - a batch contains ACCEPTED proposals only;
//  - proposals from unenacted sources (Proposed Future State) are blocked;
//  - at most one batch may sit in approved/scheduled at a time;
//  - publish runs one transaction: supersede old node versions, insert new
//    active versions (recording exact row pointers), mark proposals published,
//    compile a new KB snapshot, flip it active, audit everything;
//  - rollback is allowed only for the MOST RECENTLY published batch and uses
//    the recorded row pointers (no JSON reconstruction), then reactivates the
//    previous snapshot. Nothing is ever deleted.
// ============================================================================

import { getPool } from "../graph/db";
import { compileKb, validatePublicationGraph, type CompileNode } from "./compile";
import { insertNodeVersionTx } from "./node-write";
import { labelForNode } from "./registry";
import { ensureRkReady } from "./store";
import { writeAudit, writeAuditTx } from "./audit";
import {
  ENACTED_STATUSES,
  type ChangeProposalRow,
  type NodeType,
  type PublicationBatchRow,
  type RkNodeRow,
} from "./types";

interface Result<T = undefined> {
  ok: boolean;
  message?: string;
  batch?: PublicationBatchRow;
  extra?: T;
}

export async function listBatches(): Promise<{
  batches: (PublicationBatchRow & { item_count: number })[];
  snapshots: { id: string; version: number; is_active: boolean; created_at: string; compiled_from_batch: string | null }[];
}> {
  const pool = getPool();
  if (!pool) return { batches: [], snapshots: [] };
  await ensureRkReady();
  const batches = (
    await pool.query(`
      SELECT b.*, (SELECT count(*)::int FROM rk_publication_batch_items i WHERE i.batch_id = b.id) AS item_count
        FROM rk_publication_batches b
       ORDER BY b.created_at DESC LIMIT 100`)
  ).rows as (PublicationBatchRow & { item_count: number })[];
  const snapshots = (
    await pool.query(
      `SELECT id, version, is_active, created_at, compiled_from_batch
         FROM rk_kb_snapshots ORDER BY version DESC LIMIT 50`
    )
  ).rows as { id: string; version: number; is_active: boolean; created_at: string; compiled_from_batch: string | null }[];
  return { batches, snapshots };
}

/** Proposals eligible for a new batch: accepted, unbatched, from enacted (or no) source. */
export async function eligibleProposals(): Promise<(ChangeProposalRow & { blocked_reason?: string })[]> {
  const pool = getPool();
  if (!pool) return [];
  await ensureRkReady();
  const rows = (
    await pool.query(`
      SELECT p.*, s.title AS source_title, s.legal_status AS source_legal_status
        FROM rk_change_proposals p
        LEFT JOIN rk_regulatory_sources s ON s.id = p.source_id
       WHERE p.status = 'accepted'
         AND NOT EXISTS (
           SELECT 1 FROM rk_publication_batch_items i
             JOIN rk_publication_batches b ON b.id = i.batch_id
            WHERE i.proposal_id = p.id AND b.status <> 'rolled_back'
         )
       ORDER BY p.reviewed_at DESC NULLS LAST`)
  ).rows as ChangeProposalRow[];
  return rows.map((p) => {
    const enacted = !p.source_id || ENACTED_STATUSES.includes((p.source_legal_status ?? "proposed") as (typeof ENACTED_STATUSES)[number]);
    return enacted
      ? p
      : { ...p, blocked_reason: `source "${p.source_title}" is ${p.source_legal_status} — upgrade its legal status before publishing` };
  });
}

export async function createBatch(input: { name: string; notes?: string | null; proposalIds: string[]; actor?: string | null }): Promise<Result> {
  const pool = getPool();
  if (!pool) return { ok: false, message: "no_database" };
  await ensureRkReady();
  if (!input.name.trim()) return { ok: false, message: "name is required" };
  if (input.proposalIds.length === 0) return { ok: false, message: "select at least one accepted proposal" };

  const eligible = await eligibleProposals();
  const eligibleById = new Map(eligible.map((p) => [p.id, p]));
  for (const id of input.proposalIds) {
    const p = eligibleById.get(id);
    if (!p) return { ok: false, message: `proposal ${id} is not eligible (must be accepted and unbatched)` };
    if (p.blocked_reason) return { ok: false, message: p.blocked_reason };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `INSERT INTO rk_publication_batches (name, notes, status, created_by) VALUES ($1,$2,'draft',$3) RETURNING *`,
      [input.name.trim(), input.notes ?? null, input.actor ?? null]
    );
    const batch = res.rows[0] as PublicationBatchRow;
    for (const id of input.proposalIds) {
      const p = eligibleById.get(id)!;
      await client.query(
        `INSERT INTO rk_publication_batch_items (batch_id, proposal_id, before_json, after_json)
         VALUES ($1,$2,$3,$4)`,
        [batch.id, id, p.current_json ? JSON.stringify(p.current_json) : null, JSON.stringify(p.reviewed_json ?? p.proposed_json ?? null)]
      );
    }
    await writeAuditTx(client, {
      actor: input.actor,
      action: "batch_created",
      entityKind: "publication_batch",
      entityId: batch.id,
      after: { name: batch.name, proposals: input.proposalIds.length },
      batchId: batch.id,
    });
    await client.query("COMMIT");
    return { ok: true, batch };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, message: (err as Error).message };
  } finally {
    client.release();
  }
}

async function getBatch(id: string): Promise<PublicationBatchRow | null> {
  const pool = getPool();
  if (!pool) return null;
  return ((await pool.query(`SELECT * FROM rk_publication_batches WHERE id = $1`, [id])).rows[0] as PublicationBatchRow) ?? null;
}

export async function approveBatch(batchId: string, actor?: string | null): Promise<Result> {
  const pool = getPool();
  if (!pool) return { ok: false, message: "no_database" };
  const batch = await getBatch(batchId);
  if (!batch) return { ok: false, message: "batch not found" };
  if (batch.status !== "draft") return { ok: false, message: `batch is ${batch.status}` };
  const pending = await pool.query(
    `SELECT count(*)::int AS n FROM rk_publication_batches WHERE status IN ('approved','scheduled')`
  );
  if (Number(pending.rows[0].n) > 0) {
    return { ok: false, message: "another batch is already approved/scheduled — publish or roll it back first (one at a time keeps rollback unambiguous)" };
  }
  const res = await pool.query(
    `UPDATE rk_publication_batches SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *`,
    [batchId, actor ?? null]
  );
  await writeAudit({ actor, action: "batch_approved", entityKind: "publication_batch", entityId: batchId, batchId });
  return { ok: true, batch: res.rows[0] as PublicationBatchRow };
}

export async function scheduleBatch(batchId: string, effectiveAt: string, actor?: string | null): Promise<Result> {
  const pool = getPool();
  if (!pool) return { ok: false, message: "no_database" };
  const batch = await getBatch(batchId);
  if (!batch) return { ok: false, message: "batch not found" };
  if (batch.status !== "approved") return { ok: false, message: "approve the batch before scheduling" };
  const when = new Date(effectiveAt);
  if (isNaN(when.getTime())) return { ok: false, message: "invalid effective date" };
  const res = await pool.query(
    `UPDATE rk_publication_batches SET status='scheduled', effective_at=$2 WHERE id=$1 RETURNING *`,
    [batchId, when.toISOString()]
  );
  await writeAudit({ actor, action: "batch_scheduled", entityKind: "publication_batch", entityId: batchId, after: { effectiveAt: when.toISOString() }, batchId });
  return { ok: true, batch: res.rows[0] as PublicationBatchRow };
}

/** Lazy scheduler sweep: publish scheduled batches whose effective time passed. */
export async function publishDueBatches(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await ensureRkReady();
  const due = (
    await pool.query(
      `SELECT id FROM rk_publication_batches WHERE status='scheduled' AND effective_at <= now() ORDER BY effective_at ASC`
    )
  ).rows as { id: string }[];
  for (const b of due) {
    const result = await publishBatch(b.id, "scheduler");
    if (!result.ok) console.error(`[rk/batches] scheduled publish of ${b.id} failed: ${result.message}`);
  }
}

interface ItemRow {
  id: string;
  proposal_id: string;
}

export async function publishBatch(batchId: string, actor?: string | null): Promise<Result> {
  const pool = getPool();
  if (!pool) return { ok: false, message: "no_database" };
  await ensureRkReady();
  const batch = await getBatch(batchId);
  if (!batch) return { ok: false, message: "batch not found" };
  if (batch.status !== "approved" && batch.status !== "scheduled") {
    return { ok: false, message: `batch is ${batch.status} — approve it first` };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const items = (
      await client.query(`SELECT id, proposal_id FROM rk_publication_batch_items WHERE batch_id = $1`, [batchId])
    ).rows as ItemRow[];

    for (const item of items) {
      const p = (
        await client.query(
          `SELECT p.*, s.legal_status AS source_legal_status
             FROM rk_change_proposals p LEFT JOIN rk_regulatory_sources s ON s.id = p.source_id
            WHERE p.id = $1 FOR UPDATE OF p`,
          [item.proposal_id]
        )
      ).rows[0] as ChangeProposalRow;
      if (!p || p.status !== "accepted") throw new Error(`proposal ${item.proposal_id} is not accepted`);
      if (p.source_id && !ENACTED_STATUSES.includes((p.source_legal_status ?? "proposed") as (typeof ENACTED_STATUSES)[number])) {
        throw new Error(`proposal ${p.entity_id} comes from an unenacted source — blocked from publication`);
      }

      const base = p.base_row_id
        ? ((await client.query(`SELECT * FROM rk_nodes WHERE id = $1 FOR UPDATE`, [p.base_row_id])).rows[0] as RkNodeRow | undefined)
        : undefined;

      let supersededRowId: string | null = null;
      let newRowId: string | null = null;

      if (p.change_kind === "archive_node") {
        if (!base || base.status !== "active") throw new Error(`cannot archive ${p.entity_id}: base row changed — re-review the proposal`);
        await client.query(`UPDATE rk_nodes SET status='archived', updated_at=now() WHERE id=$1`, [base.id]);
        supersededRowId = base.id;
      } else if (p.change_kind === "update_node") {
        if (!base || base.status !== "active") throw new Error(`cannot update ${p.entity_id}: base row changed — re-review the proposal`);
        const data = (p.reviewed_json ?? p.proposed_json) as Record<string, unknown>;
        await client.query(`UPDATE rk_nodes SET status='superseded', updated_at=now() WHERE id=$1`, [base.id]);
        newRowId = await insertNodeVersionTx(client, {
          entityId: p.entity_id,
          nodeType: p.node_type as NodeType,
          label: labelForNode(p.node_type as NodeType, data),
          data,
          status: "active",
          version: base.version + 1,
          supersedesRowId: base.id,
          sourceId: p.source_id,
          citationSection: p.citation_section,
          createdBy: actor ?? null,
        });
        supersededRowId = base.id;
      } else {
        // create_node
        const existing = (
          await client.query(`SELECT 1 FROM rk_nodes WHERE entity_id = $1 AND status = 'active' LIMIT 1`, [p.entity_id])
        ).rowCount;
        if ((existing ?? 0) > 0) throw new Error(`cannot create ${p.entity_id}: an active entity with that id appeared — re-review`);
        const data = (p.reviewed_json ?? p.proposed_json) as Record<string, unknown>;
        newRowId = await insertNodeVersionTx(client, {
          entityId: p.entity_id,
          nodeType: p.node_type as NodeType,
          label: labelForNode(p.node_type as NodeType, data),
          data,
          status: "active",
          version: 1,
          sourceId: p.source_id,
          citationSection: p.citation_section,
          createdBy: actor ?? null,
        });
      }

      await client.query(
        `UPDATE rk_publication_batch_items SET superseded_row_id=$2, new_row_id=$3 WHERE id=$1`,
        [item.id, supersededRowId, newRowId]
      );
      await client.query(`UPDATE rk_change_proposals SET status='published', updated_at=now() WHERE id=$1`, [item.proposal_id]);
    }

    // Compile the new active graph into a snapshot (inside the same tx).
    const activeNodes = (
      await client.query(`SELECT entity_id, node_type, data FROM rk_nodes WHERE status='active'`)
    ).rows.map((r: { entity_id: string; node_type: NodeType; data: Record<string, unknown> }): CompileNode => ({
      entityId: r.entity_id,
      nodeType: r.node_type,
      data: r.data,
    }));
    // F08: integrity gate — a bad node (dangling/wrong-type ref, unknown rule
    // type, duplicated or self edge, inverted effective interval) blocks
    // publication instead of reaching the live engine. The throw rolls back
    // the whole batch transaction.
    const integrityProblems = validatePublicationGraph(activeNodes);
    if (integrityProblems.length > 0) {
      throw new Error(
        `PUBLICATION_BLOCKED: ${integrityProblems.length} integrity problem(s): ${integrityProblems.slice(0, 8).join("; ")}`
      );
    }
    const versionRow = await client.query(`SELECT coalesce(max(version), 0) + 1 AS v FROM rk_kb_snapshots`);
    const version = Number(versionRow.rows[0].v);
    const kb = compileKb(activeNodes, { version, batchId });
    await client.query(`UPDATE rk_kb_snapshots SET is_active=false WHERE is_active`);
    await client.query(
      `INSERT INTO rk_kb_snapshots (version, kb_json, compiled_from_batch, is_active) VALUES ($1,$2,$3,true)`,
      [version, JSON.stringify(kb), batchId]
    );

    const res = await client.query(
      `UPDATE rk_publication_batches SET status='published', published_by=$2, published_at=now() WHERE id=$1 RETURNING *`,
      [batchId, actor ?? null]
    );
    await writeAuditTx(client, {
      actor,
      action: "batch_published",
      entityKind: "publication_batch",
      entityId: batchId,
      after: { items: items.length, snapshotVersion: version },
      batchId,
    });
    await client.query("COMMIT");
    return { ok: true, batch: res.rows[0] as PublicationBatchRow };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, message: (err as Error).message };
  } finally {
    client.release();
  }
}

export async function rollbackBatch(batchId: string, actor?: string | null): Promise<Result> {
  const pool = getPool();
  if (!pool) return { ok: false, message: "no_database" };
  await ensureRkReady();
  const batch = await getBatch(batchId);
  if (!batch) return { ok: false, message: "batch not found" };
  if (batch.status !== "published") return { ok: false, message: `batch is ${batch.status}` };

  // Only the most recently published batch may be rolled back — later batches
  // may have built on these rows.
  const latest = (
    await pool.query(
      `SELECT id FROM rk_publication_batches WHERE status='published' ORDER BY published_at DESC LIMIT 1`
    )
  ).rows[0] as { id: string } | undefined;
  if (!latest || latest.id !== batchId) {
    return { ok: false, message: "only the most recently published batch can be rolled back (roll back newer batches first)" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const items = (
      await client.query(
        `SELECT id, superseded_row_id, new_row_id FROM rk_publication_batch_items WHERE batch_id = $1`,
        [batchId]
      )
    ).rows as { id: string; superseded_row_id: string | null; new_row_id: string | null }[];

    for (const item of items) {
      if (item.new_row_id) {
        await client.query(`UPDATE rk_nodes SET status='rolled_back', updated_at=now() WHERE id=$1`, [item.new_row_id]);
      }
      if (item.superseded_row_id) {
        await client.query(`UPDATE rk_nodes SET status='active', updated_at=now() WHERE id=$1`, [item.superseded_row_id]);
      }
    }
    await client.query(
      `UPDATE rk_change_proposals SET status='accepted', updated_at=now()
        WHERE id IN (SELECT proposal_id FROM rk_publication_batch_items WHERE batch_id=$1)`,
      [batchId]
    );

    // Reactivate the snapshot that was active before this batch.
    const mine = (
      await client.query(`SELECT id, version FROM rk_kb_snapshots WHERE compiled_from_batch = $1`, [batchId])
    ).rows[0] as { id: string; version: number } | undefined;
    await client.query(`UPDATE rk_kb_snapshots SET is_active=false WHERE is_active`);
    if (mine) {
      const prev = (
        await client.query(`SELECT id FROM rk_kb_snapshots WHERE version < $1 ORDER BY version DESC LIMIT 1`, [mine.version])
      ).rows[0] as { id: string } | undefined;
      if (prev) await client.query(`UPDATE rk_kb_snapshots SET is_active=true WHERE id=$1`, [prev.id]);
    }

    const res = await client.query(
      `UPDATE rk_publication_batches SET status='rolled_back', rolled_back_by=$2, rolled_back_at=now() WHERE id=$1 RETURNING *`,
      [batchId, actor ?? null]
    );
    await writeAuditTx(client, {
      actor,
      action: "batch_rolled_back",
      entityKind: "publication_batch",
      entityId: batchId,
      after: { items: items.length },
      batchId,
    });
    await client.query("COMMIT");
    return { ok: true, batch: res.rows[0] as PublicationBatchRow };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, message: (err as Error).message };
  } finally {
    client.release();
  }
}
