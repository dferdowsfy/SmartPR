// ============================================================================
// One-time resync: bring a live regulatory graph up to the corrected seed.
//
// The bundled KB JSON is the reviewed source of truth (every change is a
// code-reviewed git commit). When the live rk_nodes table was seeded from an
// older bundle, this script versions every difference the same way the
// publication-batch workflow does — old rows become 'superseded'/'archived',
// never deleted — then leaves publication (integrity gate + snapshot) to the
// existing review flow.
//
//   npx tsx scripts/rk-resync-from-seed.ts --dry-run   # report only (default)
//   DATABASE_URL=... npx tsx scripts/rk-resync-from-seed.ts --apply
//
// Refuses to run when the live graph contains non-seed edits (any active row
// with version > 1 or created_by not starting with 'seed:'), so human work is
// never silently overwritten — reconcile those by hand first.
// ============================================================================

import { getPool } from "../src/app/graph/db";
import { ensureRkReady } from "../src/app/rk/store";
import { buildSeedNodes } from "../src/app/rk/seed-data";
import { insertNodeVersionTx } from "../src/app/rk/node-write";
import { labelForNode } from "../src/app/rk/registry";
import type { NodeType } from "../src/app/rk/types";

const canon = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
    .join(",")}}`;
};

interface LiveRow {
  id: string;
  entity_id: string;
  node_type: NodeType;
  version: number;
  data: Record<string, unknown>;
  created_by: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = getPool();
  if (!pool) {
    console.error("no database: set DATABASE_URL (or DIRECT_URL) to the target project");
    process.exit(1);
  }
  await ensureRkReady();

  const live = (
    await pool.query(
      `SELECT id, entity_id, node_type, version, data, created_by FROM rk_nodes WHERE status='active'`
    )
  ).rows as LiveRow[];
  const liveByEntity = new Map(live.map((r) => [r.entity_id, r]));

  // Safety: never silently overwrite human edits.
  const edited = live.filter(
    (r) => r.version > 1 || (r.created_by && !r.created_by.startsWith("seed:"))
  );
  if (edited.length > 0) {
    console.error(
      `refusing: ${edited.length} live node(s) carry non-seed edits (e.g. ${edited
        .slice(0, 5)
        .map((r) => r.entity_id)
        .join(", ")}). Reconcile them by hand first.`
    );
    process.exit(1);
  }

  const seed = buildSeedNodes();
  const seedIds = new Set(seed.map((n) => n.entityId));

  const toCreate = seed.filter((n) => !liveByEntity.has(n.entityId));
  const toArchive = live.filter((r) => !seedIds.has(r.entity_id));
  const toUpdate = seed.filter((n) => {
    const row = liveByEntity.get(n.entityId);
    return row && row.node_type === n.nodeType && canon(row.data) !== canon(n.data);
  });
  const typeChanged = seed.filter((n) => {
    const row = liveByEntity.get(n.entityId);
    return row && row.node_type !== n.nodeType;
  });

  console.log(`live active nodes: ${live.length}`);
  console.log(`seed nodes:        ${seed.length}`);
  console.log(`to create:         ${toCreate.length}`);
  console.log(`to update:         ${toUpdate.length}`);
  console.log(`to archive:        ${toArchive.length}`);
  if (typeChanged.length > 0) {
    console.error(
      `node type changed for: ${typeChanged.map((n) => n.entityId).join(", ")} — refusing (reconcile by hand)`
    );
    process.exit(1);
  }
  if (toArchive.length > 0) {
    console.log(`archiving: ${toArchive.map((r) => r.entity_id).join(", ")}`);
  }
  const sample = (ns: { entityId: string }[]) => ns.slice(0, 12).map((n) => n.entityId).join(", ");
  if (toCreate.length > 0) console.log(`creating (first 12): ${sample(toCreate)}`);
  if (toUpdate.length > 0) console.log(`updating (first 12): ${sample(toUpdate)}`);

  if (!apply) {
    console.log("\ndry run — no writes. Re-run with --apply to perform the versioned resync.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let created = 0, updated = 0, archived = 0;

    for (const n of toCreate) {
      await insertNodeVersionTx(client, {
        entityId: n.entityId,
        nodeType: n.nodeType,
        label: n.label,
        data: n.data,
        status: "active",
        version: 1,
        createdBy: "seed:resync-from-bundled-kb",
      });
      created++;
    }
    for (const n of toUpdate) {
      const base = liveByEntity.get(n.entityId)!;
      await client.query(`UPDATE rk_nodes SET status='superseded', updated_at=now() WHERE id=$1`, [base.id]);
      await insertNodeVersionTx(client, {
        entityId: n.entityId,
        nodeType: n.nodeType,
        label: n.label,
        data: n.data,
        status: "active",
        version: base.version + 1,
        supersedesRowId: base.id,
        createdBy: "seed:resync-from-bundled-kb",
      });
      updated++;
    }
    for (const r of toArchive) {
      await client.query(`UPDATE rk_nodes SET status='archived', updated_at=now() WHERE id=$1`, [r.id]);
      archived++;
    }

    await client.query(
      `INSERT INTO rk_audit_events (actor, action, entity_kind, after_json)
       VALUES ($1,$2,$3,$4)`,
      [
        "system",
        "seed_resync",
        "graph",
        JSON.stringify({ created, updated, archived, source: "bundled kb json" }),
      ]
    );
    await client.query("COMMIT");
    console.log(`\nresync complete: ${created} created, ${updated} updated, ${archived} archived.`);
    console.log("Publication is a separate, human-reviewed step (integrity gate + snapshot compile).");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
