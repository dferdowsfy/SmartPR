// Geo-provider health for super admins.
//   GET /api/admin/geo-health          → this instance's per-endpoint health
//                                        (successes, failures, open circuits)
//   GET /api/admin/geo-health?probe=1  → also run the live check at the known
//                                        points (≈30–90 s; hits every provider)

import { requireSuperAdmin } from "../_util";
import { endpointHealthSnapshot } from "../../../locations/layerService";
import { runGeoHealth } from "../../../locations/geoHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  const probe = new URL(req.url).searchParams.get("probe") === "1";
  const endpoints = endpointHealthSnapshot();
  const report = probe ? await runGeoHealth() : null;
  return Response.json({ endpoints, report }, { headers: { "Cache-Control": "no-store" } });
}
