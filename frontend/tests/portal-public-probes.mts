/**
 * Public portal probes (Layer 4 of the portal regression system).
 *
 * Continuously checks that real agency portals are reachable and unchanged,
 * WITHOUT any authentication, PII, or filings. Pure GET requests against
 * public login/manual pages.
 *
 * Drift detection: each run records { httpStatus, redirectTo, title } per portal
 * into a state file. A change vs. the previous run is reported as DRIFT —
 * a signal for a human to review (and possibly schedule a supervised walk),
 * never something the runner "fixes" by editing expectations.
 *
 * Known portal behavior (2026-09-28): SURI answers plain GETs with
 * 302 -> ./GetWlbToken (F5 bot-gate); that redirect IS the healthy signal.
 * OGPe SBP drops plain-HTTPS connections from this vantage point
 * (empty reply) — recorded honestly as unreachable, not as portal-down.
 *
 * Usage:
 *   npx tsx tests/portal-public-probes.mts <stateDir>
 *
 * Exit code 0 = all probes completed (even if a portal is down — that is a
 * reported result, not a script failure). Prints one JSON line per portal.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Portal {
  id: string;
  label: string;
  url: string;
}

const PORTALS: Portal[] = [
  { id: "suri", label: "SURI (Hacienda)", url: "https://suri.hacienda.pr.gov" },
  {
    id: "dept-state-rcp",
    label: "Dept of State — Registro de Corporaciones",
    url: "https://rcp.estado.pr.gov/en",
  },
  {
    id: "ogpe-sbp",
    label: "OGPe Single Business Portal",
    url: "https://sbp.ogpe.pr.gov/",
  },
];

interface ProbeResult {
  id: string;
  label: string;
  url: string;
  /** true when the host returned any HTTP response (even a 3xx bot-gate redirect) */
  reachable: boolean;
  httpStatus: number | null;
  /** Location header when the response is a redirect (e.g. SURI's ./GetWlbToken bot gate) */
  redirectTo: string | null;
  finalUrl: string | null;
  title: string | null;
  error: string | null;
  drift: boolean;
  driftDetail: string | null;
  checkedAt: string;
}

const FETCH_TIMEOUT_MS = 20_000;

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, " ").trim().slice(0, 200) || null;
}

async function probe(p: Portal): Promise<Omit<ProbeResult, "drift" | "driftDetail" | "checkedAt">> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // redirect:"manual" — portals like SURI answer plain GETs with a 302 to a
    // bot-gate token endpoint (./GetWlbToken). Following it just loops, so we
    // record the redirect itself as the signal.
    const res = await fetch(p.url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "SmartPR-portal-probe/1.0 (+https://www.getsmartpr.com)" },
    });
    const httpStatus = res.status;
    const redirectTo = res.headers.get("location");
    let title: string | null = null;
    if (httpStatus === 200) {
      const text = await res.text();
      title = extractTitle(text);
    }
    return {
      id: p.id,
      label: p.label,
      url: p.url,
      reachable: true,
      httpStatus,
      redirectTo,
      finalUrl: null,
      title,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: p.id,
      label: p.label,
      url: p.url,
      reachable: false,
      httpStatus: null,
      redirectTo: null,
      finalUrl: null,
      title: null,
      error: msg.slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

function main() {
  const stateDir = process.argv[2] ?? "/tmp/portal-probe-state";
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, "portal-probe-state.json");

  let prev: Record<string, { httpStatus: number | null; redirectTo: string | null; title: string | null }> = {};
  if (existsSync(statePath)) {
    try {
      prev = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      prev = {};
    }
  }

  const run = async () => {
    const results: ProbeResult[] = [];
    for (const p of PORTALS) {
      const r = await probe(p);
      const before = prev[p.id];
      let drift = false;
      let driftDetail: string | null = null;
      if (before) {
        const changes: string[] = [];
        if (before.httpStatus !== r.httpStatus) changes.push(`status ${before.httpStatus} -> ${r.httpStatus}`);
        if (before.redirectTo !== r.redirectTo) changes.push(`redirect "${before.redirectTo}" -> "${r.redirectTo}"`);
        if (before.title !== r.title) changes.push(`title "${before.title}" -> "${r.title}"`);
        if (changes.length > 0) {
          drift = true;
          driftDetail = changes.join("; ");
        }
      }
      results.push({ ...r, drift, driftDetail, checkedAt: new Date().toISOString() });
      // One JSON line per portal, for the log.
      console.log(JSON.stringify({ id: r.id, reachable: r.reachable, httpStatus: r.httpStatus, redirectTo: r.redirectTo, title: r.title, error: r.error, drift, driftDetail }));
    }

    const next: Record<string, { httpStatus: number | null; redirectTo: string | null; title: string | null }> = {};
    for (const r of results) next[r.id] = { httpStatus: r.httpStatus, redirectTo: r.redirectTo, title: r.title };
    writeFileSync(statePath, JSON.stringify(next, null, 2));

    const logPath = join(stateDir, "portal-probes.log");
    const stamp = new Date().toISOString();
    const line =
      `${stamp} ` +
      results.map((r) => `${r.id}:${r.reachable ? `http${r.httpStatus}` : "UNREACHABLE"}${r.drift ? ":DRIFT" : ""}`).join(" ") +
      "\n";
    writeFileSync(logPath, line, { flag: "a" });

    const down = results.filter((r) => !r.reachable);
    // Teach Clara (§9): hand drift/unreachable signals to skill health, when
    // configured. Best-effort — never changes this script's exit code.
    if (process.env.SKILL_HEALTH_URL && process.env.SKILL_HEALTH_CRON_SECRET) {
      await fetch(process.env.SKILL_HEALTH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cron-secret": process.env.SKILL_HEALTH_CRON_SECRET },
        body: JSON.stringify({ results: results.map((r) => ({ url: r.url, reachable: r.reachable, drift: r.drift, driftDetail: r.driftDetail })) }),
      }).catch((e) => console.error(`skill health post failed: ${(e as Error).message}`));
    }
    const drifted = results.filter((r) => r.drift);
    if (down.length > 0 || drifted.length > 0) {
      console.error(
        `PROBE SIGNAL: ${down.map((r) => `${r.id} unreachable (${r.error})`).join(", ")}${down.length && drifted.length ? "; " : ""}${drifted.map((r) => `${r.id} drift (${r.driftDetail})`).join(", ")}`
      );
    }
  };

  run().catch((err) => {
    console.error(`probe runner failed: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  });
}

main();
