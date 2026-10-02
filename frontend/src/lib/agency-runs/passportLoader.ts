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
  const [raw, canonical, facts] = await Promise.all([
    loadPassportForBusiness(businessId, userId),
    loadCanonicalPassportForBusiness(businessId, userId),
    loadProjectFilingFactsForBusiness(businessId, userId),
  ]);
  // The canonical Passport also carries the facts kept in the business row's
  // columns (legal name, municipality, structure …); keep the raw keys and
  // _denormalized for callers that read them.
  const passport = raw || canonical ? { ...(raw ?? {}), ...(canonical ?? {}), ...(raw?._denormalized ? { _denormalized: raw._denormalized } : {}) } : null;
  return withProjectFacts(passport, facts);
}

/**
 * The business's canonical Business Passport (CanonicalApplicationData):
 * the business row's own columns (legal name, registry number, structure,
 * municipality, address) merged with passport_json — the same shape the
 * passport catalog paths (business.legalName, addresses.municipality …)
 * read. Teach Clara, Fill with Clara and the workspace's Passport panel use
 * this; the raw passport_json alone misses everything kept in columns.
 * Owner/workspace-member gated; null when unavailable.
 */
export async function loadCanonicalPassportForBusiness(
  businessId: string,
  userId: string | null
): Promise<Record<string, unknown> | null> {
  if (!userId) return null;
  try {
    const { getPool, isEnabled } = await import("../../app/graph/db");
    const { ensureSchema, resolveBusinessUuid } = await import("../../app/graph/store");
    const { canonicalFromBusinessRow } = await import("../../app/forms/engine/businessPassport");
    if (!isEnabled()) return null;
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    const businessUuid = await resolveBusinessUuid(pool, businessId);
    if (!businessUuid) return null;
    const { rows } = await pool.query(
      `SELECT b.passport_json, b.legal_name, b.name, b.entity_number, b.business_structure,
              b.municipality, b.physical_address, b.onboarding_mode
         FROM businesses b
         LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
        WHERE b.id=$1 AND b.archived=false AND (b.user_id=$2 OR wm.user_id IS NOT NULL)`,
      [businessUuid, userId]
    );
    const row = rows[0];
    if (!row) return null;
    const canonical = canonicalFromBusinessRow(row) as unknown as { business: Record<string, unknown> } & Record<string, unknown>;
    // "other" is the empty placeholder, not a fact about the business.
    if (canonical.business.entityType === "other") delete canonical.business.entityType;
    if (!canonical.business.legalName && row.name) canonical.business.legalName = String(row.name);
    splitContactName(canonical as unknown as Record<string, unknown>);
    return canonical;
  } catch {
    return null;
  }
}

/**
 * Portals ask for the person's name in parts (Primer nombre, Primer apellido
 * …). Derive them from contact.fullName when the Passport has only that:
 * "Ana Luisa Pérez Díaz" → first "Ana", middle "Luisa", last "Pérez",
 * second last "Díaz" (Puerto Rican two-surname order). Existing parts win.
 */
export function splitContactName(passport: Record<string, unknown>): void {
  const contact = (passport.contact ??= {}) as Record<string, unknown>;
  const full = typeof contact.fullName === "string" ? contact.fullName.replace(/\s+/g, " ").trim() : "";
  if (!full) return;
  const t = full.split(" ");
  const parts =
    t.length === 1 ? { firstName: t[0] }
    : t.length === 2 ? { firstName: t[0], lastName: t[1] }
    : t.length === 3 ? { firstName: t[0], lastName: t[1], secondLastName: t[2] }
    : { firstName: t[0], middleName: t.slice(1, -2).join(" "), lastName: t.at(-2), secondLastName: t.at(-1) };
  for (const [k, v] of Object.entries(parts)) if (v && !contact[k]) contact[k] = v;
}
