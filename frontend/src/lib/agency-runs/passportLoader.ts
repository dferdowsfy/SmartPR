/**
 * Best-effort Business Passport load for agency runs.
 * Returns null when DB/auth is unavailable — Browser Use still starts with an empty passport note.
 */

export async function loadPassportForBusiness(
  businessId: string,
  userId: string | null
): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  try {
    const { getPool, isEnabled } = await import("../../app/graph/db");
    const { ensureSchema, resolveBusinessUuid } = await import("../../app/graph/store");
    if (!isEnabled()) return null;
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    const businessUuid = await resolveBusinessUuid(pool, businessId);
    if (!businessUuid) return null;
    const { rows } = await pool.query(
      `SELECT b.passport_json, b.legal_name, b.name, b.entity_number, b.business_structure,
              b.municipality, b.physical_address
         FROM businesses b
         LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
        WHERE b.id=$1 AND b.archived=false AND (b.user_id=$2 OR wm.user_id IS NOT NULL)`,
      [businessUuid, userId]
    );
    const row = rows[0];
    if (!row) return null;
    const passport =
      row.passport_json && typeof row.passport_json === "object"
        ? (row.passport_json as Record<string, unknown>)
        : {};
    return {
      ...passport,
      _denormalized: {
        legal_name: row.legal_name,
        name: row.name,
        entity_number: row.entity_number,
        business_structure: row.business_structure,
        municipality: row.municipality,
        physical_address: row.physical_address,
      },
    };
  } catch {
    // DB optional for local UI demos — never log connection strings / secrets.
    return null;
  }
}

/**
 * The Passport plus this business's confirmed project facts (filling Passport
 * gaps only) — what Clara checks before asking the user for anything.
 */
export async function loadFilingFactsForBusiness(
  businessId: string,
  userId: string | null
): Promise<Record<string, unknown> | null> {
  const [{ withProjectFacts }, { loadProjectFilingFactsForBusiness }] = await Promise.all([
    import("./filingFacts"),
    import("./projectContextLoader"),
  ]);
  const [passport, facts] = await Promise.all([
    loadPassportForBusiness(businessId, userId),
    loadProjectFilingFactsForBusiness(businessId, userId),
  ]);
  return withProjectFacts(passport, facts);
}
