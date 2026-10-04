/**
 * Save one Business Passport detail from Teach Clara (or any Clara
 * workspace) — the Passport stays the single source of truth.
 *
 *  - Regular details: written into businesses.passport_json at their
 *    canonical path, with the list columns kept in sync exactly like the
 *    Passport page's save (PATCH /api/businesses/[id]).
 *  - Protected details (SSN / ITIN): encrypted into
 *    passport_protected_values; passport_json only gets the on-file marker
 *    and last 4. The value is returned nowhere and read only at fill time.
 *
 * Owner / workspace-member gated. Never logs values.
 */
import { catalogEntry, isAdditionalPath, protectedMarkerPaths, setPassportPath } from "./teach/passportCatalog";

export class PassportWriteError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface PassportStore {
  /** Save one value; returns the masked preview the UI may show. */
  save(input: { businessId: string; userId: string; path: string; value: string }): Promise<{ preview: string }>;
  /** A protected value for fill time only (null when not on file). */
  readProtected(input: { businessId: string; userId: string; path: string }): Promise<string | null>;
}

/** Only catalog paths and teacher-added details can be written from Clara. */
export function writablePath(path: string): boolean {
  return Boolean(catalogEntry(path)) || isAdditionalPath(path);
}

/** Normalize what the person typed for a path (numbers stay numbers, entity types lower-case). */
export function normalizeValue(path: string, raw: string): string | number {
  const v = raw.replace(/\s+/g, " ").trim().slice(0, 256);
  if (/employeeCount|llcMemberCount|squareFootage|estimatedAnnual/i.test(path)) {
    const n = Number(v.replace(/[,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (path === "business.entityType") return v.toLowerCase();
  if (catalogEntry(path)?.sensitive) return v.replace(/[^0-9A-Za-z]/g, "");
  return v;
}

export function maskedPreview(path: string, value: string | number): string {
  const text = String(value);
  if (catalogEntry(path)?.sensitive) return `•••-••-${text.slice(-4)}`;
  if (/(ein|registryNumber|merchantRegistrationNumber|cadastralNumber|TaxpayerId)$/i.test(path)) return text.length > 4 ? `•••• ${text.slice(-4)}` : "••••";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Encryption key for protected Passport details, tagged by source so stored
 * values keep decrypting if a dedicated key is added later:
 *   p: PASSPORT_ENC_KEY (64 hex)                      — preferred
 *   e: ENTERPRISE_WEBHOOK_ENC_KEY (64 hex)            — existing enterprise key
 *   d: SHA-256("smartpr:passport-protected:v1:" + SUPABASE_SERVICE_ROLE_KEY)
 *      — derived from a server-only secret already configured, so protected
 *        details work without extra setup. Never sent to the browser.
 */
export async function passportKey(tag?: string): Promise<{ tag: string; key: Buffer } | null> {
  const { createHash } = await import("node:crypto");
  const hex = (v: string | undefined) => (v && /^[0-9a-fA-F]{64}$/.test(v.trim()) ? Buffer.from(v.trim(), "hex") : null);
  const candidates: { tag: string; key: () => Buffer | null }[] = [
    { tag: "p", key: () => hex(process.env.PASSPORT_ENC_KEY) },
    { tag: "e", key: () => hex(process.env.ENTERPRISE_WEBHOOK_ENC_KEY) },
    {
      tag: "d",
      key: () => {
        const base = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
        return base.length >= 20 ? createHash("sha256").update(`smartpr:passport-protected:v1:${base}`).digest() : null;
      },
    },
  ];
  for (const c of candidates) {
    if (tag && c.tag !== tag) continue;
    const key = c.key();
    if (key) return { tag: c.tag, key };
  }
  return null;
}

export function dbPassportStore(): PassportStore {
  return {
    async save({ businessId, userId, path, value }) {
      if (!writablePath(path)) throw new PassportWriteError(400, "unknown_detail", "That Passport detail can't be saved here.");
      const normalized = normalizeValue(path, value);
      if (normalized === "" ) throw new PassportWriteError(400, "empty", "Type a value first.");
      const { getPool, isEnabled } = await import("../../app/graph/db");
      const { ensureSchema, resolveBusinessUuid } = await import("../../app/graph/store");
      const { canonicalFromBusinessRow, passportJsonFromCanonical, denormalizedColumnsFromPassport } = await import("../../app/forms/engine/businessPassport");
      if (!isEnabled()) throw new PassportWriteError(503, "no_database", "The Passport can't be saved right now.");
      const pool = getPool();
      if (!pool) throw new PassportWriteError(503, "no_database", "The Passport can't be saved right now.");
      await ensureSchema();
      const businessUuid = await resolveBusinessUuid(pool, businessId);
      if (!businessUuid) throw new PassportWriteError(404, "not_found", "Business not found.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = (await client.query<{ passport_json: Record<string, unknown> | null }>(
          `SELECT b.passport_json FROM businesses b
            WHERE b.id=$1 AND b.archived=false AND (b.user_id=$2 OR EXISTS (
              SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=b.workspace_id AND wm.user_id=$2))
            FOR UPDATE`,
          [businessUuid, userId]
        )).rows[0];
        if (!row) throw new PassportWriteError(404, "not_found", "Business not found.");
        const passport = (row.passport_json && typeof row.passport_json === "object" ? row.passport_json : {}) as Record<string, unknown>;
        if (catalogEntry(path)?.sensitive) {
          const { encryptSecret } = await import("../enterprise-security");
          const k = await passportKey();
          if (!k) throw new PassportWriteError(503, "protected_storage_unavailable", "Protected storage isn't set up, so this detail can't be saved yet.");
          const ciphertext = `${k.tag}:${encryptSecret(String(normalized), k.key)}`;
          const last4 = String(normalized).slice(-4);
          await client.query(
            `INSERT INTO passport_protected_values (business_id, path, ciphertext, last4, updated_by, updated_at)
             VALUES ($1,$2,$3,$4,$5,now())
             ON CONFLICT (business_id, path) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, last4=EXCLUDED.last4, updated_by=EXCLUDED.updated_by, updated_at=now()`,
            [businessUuid, path, ciphertext, last4, userId]
          );
          const m = protectedMarkerPaths(path);
          setPassportPath(passport, m.onFile, true);
          setPassportPath(passport, m.last4, last4);
        } else {
          setPassportPath(passport, path, normalized);
        }
        // Same normalization + column sync as the Passport page's save.
        const canonical = canonicalFromBusinessRow({ passport_json: passport } as never);
        const normalizedJson = passportJsonFromCanonical(canonical);
        const denorm = denormalizedColumnsFromPassport(canonical);
        await client.query(
          `UPDATE businesses SET passport_json=$2::jsonb,
             legal_name=COALESCE($3,legal_name), name=COALESCE($3,name),
             entity_number=COALESCE($4,entity_number), business_structure=COALESCE($5,business_structure),
             municipality=COALESCE($6,municipality), physical_address=COALESCE($7,physical_address), updated_at=now()
           WHERE id=$1`,
          [businessUuid, JSON.stringify(normalizedJson), denorm.legal_name, denorm.entity_number, denorm.business_structure, denorm.municipality, denorm.physical_address]
        );
        await client.query("COMMIT");
        return { preview: maskedPreview(path, normalized) };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async readProtected({ businessId, userId, path }) {
      if (!catalogEntry(path)?.sensitive) return null;
      const { getPool, isEnabled } = await import("../../app/graph/db");
      const { resolveBusinessUuid } = await import("../../app/graph/store");
      if (!isEnabled()) return null;
      const pool = getPool();
      if (!pool) return null;
      const businessUuid = await resolveBusinessUuid(pool, businessId);
      if (!businessUuid) return null;
      const row = (await pool.query<{ ciphertext: string }>(
        `SELECT p.ciphertext FROM passport_protected_values p JOIN businesses b ON b.id=p.business_id
          WHERE p.business_id=$1 AND p.path=$2 AND (b.user_id=$3 OR EXISTS (
            SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=b.workspace_id AND wm.user_id=$3))`,
        [businessUuid, path, userId]
      )).rows[0];
      if (!row) return null;
      try {
        const { decryptSecret } = await import("../enterprise-security");
        const m = /^([ped]):(enc_v1:.*)$/.exec(row.ciphertext);
        const k = await passportKey(m ? m[1] : "e");
        if (!k) return null;
        return decryptSecret(m ? m[2] : row.ciphertext, k.key);
      } catch {
        return null;
      }
    },
  };
}
