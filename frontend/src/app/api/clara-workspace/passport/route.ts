/**
 * GET /api/clara-workspace/passport?business_id=… — the Business Passport
 * fields Clara can map a portal field to, and whether this business has
 * each one on file (for the Teach Clara / Fill with Clara workspace).
 *
 * Owner-gated (loadPassportForBusiness checks membership). Identifier
 * values are masked to their last 4 characters; nothing here is sent to a
 * model.
 */
import { loadCanonicalPassportForBusiness as loadPassportForBusiness } from "../../../../lib/agency-runs/passportLoader";
import { PASSPORT_CATALOG, readPassportPath } from "../../../../lib/agency-runs/teach/passportCatalog";
import { currentViewer, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASKED = /(ein|ssn|registryNumber|merchantRegistrationNumber|catastro|account|license|permitNumber)/i;

function preview(path: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "object" ? "" : String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (MASKED.test(path)) return text.length > 4 ? `•••• ${text.slice(-4)}` : "••••";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export async function GET(req: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const businessId = new URL(req.url).searchParams.get("business_id");
  const passport = businessId && !businessId.startsWith("local-") ? await loadPassportForBusiness(businessId, viewer.userId) : null;
  const fields = PASSPORT_CATALOG.map((c) => {
    const v = passport ? readPassportPath(passport, c.path) : undefined;
    const p = preview(c.path, v);
    return { path: c.path, en: c.en, es: c.es, has: p !== null, preview: p };
  });
  return Response.json({ business_id: businessId, loaded: passport !== null, fields }, { headers: { "Cache-Control": "no-store" } });
}
