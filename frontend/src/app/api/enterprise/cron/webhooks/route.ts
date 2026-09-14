// Phase 6 — webhook delivery runner (cron).
// POST/GET /api/enterprise/cron/webhooks
//
// Retries due webhook deliveries with exponential backoff (max 5 attempts,
// then dead-lettered). Same auth pattern as the requirement-monitor cron:
//   header `x-cron-secret: $ENTERPRISE_CRON_SECRET`
// Without the secret, a signed-in platform admin may still trigger it.

import { timingSafeEqual } from "node:crypto";
import { isEnabled } from "../../../../graph/db";
import { isCurrentUserAdmin } from "../../../../../lib/admin";
import { runWebhookDeliverySweep } from "../../../../../lib/enterprise-integrations";
import { withEnterpriseHandler } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.ENTERPRISE_CRON_SECRET;
  if (!secret) return false;
  const presented = req.headers.get("x-cron-secret");
  if (!presented) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const result = await runWebhookDeliverySweep();
  return Response.json({ ok: true, ...result });
}

async function postHandler(req: Request) {
  if (!cronAuthorized(req)) {
    if (!(await isCurrentUserAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return handle(req);
}

async function getHandler(req: Request) {
  if (!cronAuthorized(req)) {
    if (!(await isCurrentUserAdmin())) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return handle(req);
}

export const POST = withEnterpriseHandler("POST /api/enterprise/cron/webhooks", postHandler);
export const GET = withEnterpriseHandler("GET /api/enterprise/cron/webhooks", getHandler);
