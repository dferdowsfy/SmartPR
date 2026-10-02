// POST /api/businesses/[id]/obligations — add a filing date the user knows
// (a custom filing, e.g. an insurance renewal or a permit not in the plan).
// The date is USER_PROVIDED (or DOCUMENT_EXTRACTED when taken from a
// document/notice), never presented as a regulatory rule. Reminders follow
// the filing's own schedule and email choice (scheduleObligationNotifications).
import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../../../graph/db";
import { ensureSchema, resolveBusinessUuid } from "../../../../graph/store";
import { getCurrentUser } from "../../../../../lib/supabase/server";
import { scheduleObligationNotifications, userCanAccessBusiness } from "../../../../compliance/server";
import { deriveObligationStatus, nextActionForStatus, normalizeReminderDays, validDateOnly } from "../../../../compliance/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  name?: string;
  agency?: string | null;
  due_date?: string;
  due_date_source?: "USER_PROVIDED" | "DOCUMENT_EXTRACTED";
  source_reference?: string | null;
  renewal_frequency_months?: number | null;
  reminder_days?: number[];
  reminder_email?: boolean;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const body: CreateBody = await req.json().catch(() => ({}));
  const name = body.name?.trim().slice(0, 200) ?? "";
  if (!name) return Response.json({ error: "A filing name is required." }, { status: 400 });
  const dueDate = validDateOnly(body.due_date);
  if (!dueDate) return Response.json({ error: "Due date must use YYYY-MM-DD." }, { status: 400 });
  const source = body.due_date_source === "DOCUMENT_EXTRACTED" ? "DOCUMENT_EXTRACTED" : "USER_PROVIDED";
  const months = typeof body.renewal_frequency_months === "number" && body.renewal_frequency_months > 0 && body.renewal_frequency_months <= 120
    ? Math.round(body.renewal_frequency_months) : null;

  await ensureSchema();
  const client = await pool.connect();
  try {
    const businessUuid = await resolveBusinessUuid(client, id);
    if (!businessUuid || !(await userCanAccessBusiness(client, user.id, businessUuid))) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    await client.query("BEGIN");
    const biz = (await client.query<{ workspace_id: string | null; business_name: string }>(
      `SELECT workspace_id, COALESCE(legal_name, name) AS business_name FROM businesses WHERE id = $1`, [businessUuid]
    )).rows[0];
    const obligationId = randomUUID();
    const status = deriveObligationStatus({ evidenceState: "NONE", dueDate, expectsRenewal: true });
    await client.query(
      `INSERT INTO obligations
         (id, business_id, name, agency, status, due_date, due_date_source, source, source_reference,
          verified_at, renewal_frequency_months, mandatory, next_action, reminder_days, reminder_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'USER_ADDED',$8,now(),$9,false,$10,$11,$12)`,
      [obligationId, businessUuid, name, body.agency?.trim().slice(0, 120) || null, status, dueDate, source,
        body.source_reference?.trim().slice(0, 300) || null, months, nextActionForStatus(status),
        normalizeReminderDays(body.reminder_days ?? null), body.reminder_email !== false]
    );
    await scheduleObligationNotifications(client, {
      userId: user.id,
      workspaceId: biz?.workspace_id ?? null,
      businessId: businessUuid,
      businessName: biz?.business_name ?? "",
      obligationId,
      obligationName: name,
      dueDate,
    });
    await client.query("COMMIT");
    return Response.json({ created: true, id: obligationId, status }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[obligations] create", (error as Error).message);
    return Response.json({ error: "Could not add the filing date." }, { status: 500 });
  } finally {
    client.release();
  }
}
