// Map-data review queue for super admins.
//   GET /api/admin/review-queue → the latest stored `npm run geo:drift` result,
//                                 grouped by who reviews it. Read-only: no live
//                                 lookups, no rule or fixture changes.

import { requireSuperAdmin } from "../_util";
import { loadReviewQueue } from "../../../locations/siteCases/reviewQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  return Response.json(loadReviewQueue(), { headers: { "Cache-Control": "no-store" } });
}
