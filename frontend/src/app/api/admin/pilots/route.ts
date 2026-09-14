// Admin pilot-activity view: per partner code, who redeemed it and what each
// member actually did (assessments, forms prepared, uploads validated,
// deliverables). Powers /admin/pilots — "which forms are they filling out".
import { getPool, isEnabled } from "../../../graph/db";
import { isCurrentUserAdmin } from "../../../../lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberActivity = {
  user_id: string;
  email: string | null;
  role: string;
  redeemed_at: string;
  assessments: number;
  forms_prepared: Array<{ form_code: string; count: number }>;
  uploads_validated: number;
  deliverables: number;
  last_active: string | null;
};

async function memberActivity(
  q: { query: (t: string, p: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  userId: string
): Promise<Omit<MemberActivity, "user_id" | "email" | "role" | "redeemed_at">> {
  const num = async (text: string): Promise<number> => {
    const { rows } = await q.query(text, [userId]);
    return Number(rows[0]?.n || 0);
  };
  const assessments = await num(`SELECT COUNT(*)::text AS n FROM submissions WHERE user_id = $1`);
  const uploads_validated = await num(
    `SELECT COUNT(*)::text AS n FROM document_validations WHERE user_id = $1`
  );
  const deliverables = await num(`SELECT COUNT(*)::text AS n FROM deliverables WHERE user_id = $1`);
  const { rows: forms } = await q.query(
    `SELECT form_code, COUNT(*)::int AS count FROM artifact_generations
      WHERE user_id = $1 GROUP BY form_code ORDER BY count DESC`,
    [userId]
  );
  const { rows: last } = await q.query(
    `SELECT MAX(t)::text AS last_active FROM (
       SELECT MAX(created_at) AS t FROM submissions WHERE user_id = $1
       UNION ALL SELECT MAX(created_at) FROM artifact_generations WHERE user_id = $1
       UNION ALL SELECT MAX(created_at) FROM document_validations WHERE user_id = $1
       UNION ALL SELECT MAX(generated_at) FROM deliverables WHERE user_id = $1
     ) s`,
    [userId]
  );
  return {
    assessments,
    forms_prepared: forms as Array<{ form_code: string; count: number }>,
    uploads_validated,
    deliverables,
    last_active: (last[0]?.last_active as string | null) ?? null,
  };
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  try {
    const { rows: codes } = await pool.query(
      `SELECT id, code, plan::text AS plan, workspace_id, workspace_name,
              max_redemptions, redemption_count, pilot_days, expires_at, active
         FROM partner_codes ORDER BY created_at DESC LIMIT 100`
    );
    const pilots = [];
    for (const c of codes as Array<Record<string, unknown>>) {
      const { rows: members } = await pool.query(
        `SELECT r.user_id, u.email, COALESCE(wm.role, 'MEMBER') AS role, r.redeemed_at
           FROM partner_code_redemptions r
           LEFT JOIN users u ON u.id = r.user_id
           LEFT JOIN workspace_members wm
             ON wm.workspace_id = r.workspace_id AND wm.user_id = r.user_id
          WHERE r.partner_code_id = $1
          ORDER BY r.redeemed_at ASC`,
        [c.id]
      );
      const memberRows: MemberActivity[] = [];
      for (const m of members as Array<Record<string, unknown>>) {
        const activity = await memberActivity(pool, m.user_id as string).catch(() => ({
          assessments: 0,
          forms_prepared: [],
          uploads_validated: 0,
          deliverables: 0,
          last_active: null,
        }));
        memberRows.push({
          user_id: m.user_id as string,
          email: (m.email as string | null) ?? null,
          role: (m.role as string) || "MEMBER",
          redeemed_at: m.redeemed_at as string,
          ...activity,
        });
      }
      pilots.push({
        code: c.code,
        workspace_name: c.workspace_name,
        plan: c.plan,
        workspace_id: c.workspace_id,
        redemptions_used: c.redemption_count,
        max_redemptions: c.max_redemptions,
        pilot_days: c.pilot_days,
        expires_at: c.expires_at,
        active: c.active,
        members: memberRows,
      });
    }
    return Response.json({ pilots });
  } catch (err) {
    const msg = (err as Error).message;
    if (/partner_codes|artifact_generations/i.test(msg) && /does not exist|relation/i.test(msg)) {
      return Response.json(
        { error: "schema_missing", message: "Apply data/partner_codes_schema.sql first.", pilots: [] },
        { status: 503 }
      );
    }
    throw err;
  }
}
