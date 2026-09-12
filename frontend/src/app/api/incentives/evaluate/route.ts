import { evaluateIncentives } from "../../../incentives/engine";
import { compileIncentiveCatalog } from "../../../incentives/catalog";
import { PR_ACT60_CATALOG } from "../../../incentives/prCatalog";
import type { IncentiveProgram, NormalizedProjectProfile } from "../../../incentives/types";
import { isEnabled } from "../../../graph/db";
import { activeCompileNodes, ensureRkReady } from "../../../rk/store";
import { mergeProgramCatalogs } from "../../../incentives/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { profile?: NormalizedProjectProfile; verifiedEvidenceTypeIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
    return Response.json({ error: "profile is required" }, { status: 400 });
  }

  // Program source precedence: the published knowledge graph is authoritative
  // when the graph store is configured (see mergeProgramCatalogs above); the
  // static catalog is the fallback when it is not.
  let programs = PR_ACT60_CATALOG;
  let catalogVersion = "pr-act60-static-2026-09-04.1";
  let catalogWarnings = 0;

  if (isEnabled()) {
    await ensureRkReady();
    const catalog = compileIncentiveCatalog(await activeCompileNodes());
    programs = mergeProgramCatalogs(catalog.programs, PR_ACT60_CATALOG);
    catalogVersion = `${catalogVersion}|${catalog.catalogVersion}`;
    catalogWarnings = catalog.rejected.length;
  }

  const assessment = evaluateIncentives(body.profile, programs, {
    catalogVersion,
    verifiedEvidenceTypeIds: body.verifiedEvidenceTypeIds,
  });
  return Response.json({ ...assessment, catalogWarnings });
}
