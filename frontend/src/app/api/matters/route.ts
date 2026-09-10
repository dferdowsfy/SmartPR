import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../graph/db";
import { ensureSchema, ensureUniquePublicId, resolveBusinessUuid } from "../../graph/store";
import { getCurrentUser } from "../../../lib/supabase/server";
import { ensureUserWorkspace, userCanAccessBusiness } from "../../compliance/server";
import { DUE_DATE_SOURCES, MATTER_TYPES, type DueDateSource, type MatterType } from "../../compliance/types";
import { validDateOnly } from "../../compliance/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateMatterBody {
  business_id?: string;
  create_business?: boolean;
  legal_name?: string;
  matter_type?: MatterType;
  title?: string;
  due_date?: string | null;
  due_date_source?: DueDateSource;
  source_reference?: string | null;
}

const defaultTitle = (type: MatterType) => type.split("_").map((word) =>
  word.charAt(0) + word.slice(1).toLowerCase()
).join(" ");

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });
  let body: CreateMatterBody;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const matterType = body.matter_type && MATTER_TYPES.includes(body.matter_type)
    ? body.matter_type : "OTHER";
  const dueDate = body.due_date ? validDateOnly(body.due_date) : null;
  if (body.due_date && !dueDate) return Response.json({ error: "Due date must use YYYY-MM-DD." }, { status: 400 });
  const dueSource = dueDate && body.due_date_source && DUE_DATE_SOURCES.includes(body.due_date_source)
    ? body.due_date_source : "UNKNOWN";
  if (dueDate && dueSource === "UNKNOWN") {
    return Response.json({ error: "A due-date source is required whenever a date is entered." }, { status: 400 });
  }

  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = await ensureUserWorkspace(client, user);
    let businessId = body.business_id ?? null;
    let businessPublicId: string | null = null;
    let businessName = (body.legal_name || "").trim();
    if (body.create_business) {
      businessId = randomUUID();
      businessPublicId = await ensureUniquePublicId(client);
      businessName ||= "Untitled business";
      await client.query(
        `INSERT INTO businesses
           (id, user_id, workspace_id, name, legal_name, onboarding_mode, public_id)
         VALUES ($1,$2,$3,$4,$4,'NEW',$5)`,
        [businessId, user.id, workspaceId, businessName, businessPublicId]
      );
    } else if (businessId) {
      // Accept either the short public id or the full UUID.
      const resolved = await resolveBusinessUuid(client, businessId);
      if (!resolved) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Business not found." }, { status: 404 });
      }
      businessId = resolved;
    }
    if (!businessId || !(await userCanAccessBusiness(client, user.id, businessId))) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Business not found." }, { status: 404 });
    }
    if (!businessName) {
      const row = await client.query<{ name: string; public_id: string | null }>(
        `SELECT COALESCE(legal_name, name) AS name, public_id FROM businesses WHERE id = $1`, [businessId]
      );
      businessName = row.rows[0]?.name || "Business";
      businessPublicId = row.rows[0]?.public_id ?? businessPublicId;
    }
    const matterId = randomUUID();
    await client.query(
      `INSERT INTO matters
         (id, business_id, workspace_id, user_id, matter_type, title, status, due_date,
          due_date_source, source_reference, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,
               CASE WHEN $8 <> 'UNKNOWN' THEN now() ELSE NULL END)`,
      [matterId, businessId, workspaceId, user.id, matterType,
        (body.title || "").trim() || defaultTitle(matterType), dueDate, dueSource,
        body.source_reference ?? null]
    );
    await client.query("COMMIT");
    return Response.json({ business_id: businessId, business_public_id: businessPublicId, business_name: businessName, matter_id: matterId, matter_type: matterType });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[matters] create", (error as Error).message);
    return Response.json({ error: "Could not start this filing." }, { status: 500 });
  } finally {
    client.release();
  }
}
