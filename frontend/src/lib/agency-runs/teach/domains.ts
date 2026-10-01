/**
 * Which sites a teach session may run on.
 *
 * Government domains (.gov, .pr.gov, .gov.pr, .mil) are open to every
 * teacher. Any other site must be approved: listed in a hand-written filing
 * config, an official portal in SmartPR's own requirement catalog
 * (kb/regulatory_processes.json — e.g. LUMA's interconnection portal),
 * listed in TEACH_APPROVED_DOMAINS (comma-separated hosts), or taught by an
 * admin — an admin teaching a site is the approval. HTTPS only; IP literals
 * and localhost are never allowed. A taught routine's replay is allowed only
 * on its own portal's domain (plus government sign-in hosts).
 */
import { AGENCY_FILING_CONFIGS } from "../filingTypes";
import processesJson from "../../../kb/regulatory_processes.json";

/** Official portal hosts from SmartPR's requirement catalog (curated data, not user input). */
export function catalogPortalHosts(): string[] {
  const hosts = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node !== "object") return;
    const portal = (node as { portal?: { url?: unknown } }).portal;
    if (portal && typeof portal.url === "string") {
      try {
        const u = new URL(portal.url);
        if (u.protocol === "https:") hosts.add(u.hostname.toLowerCase().replace(/^www\./, ""));
      } catch {
        /* skip */
      }
    }
    for (const v of Object.values(node as Record<string, unknown>)) if (v && typeof v === "object") walk(v, depth + 1);
  };
  walk(processesJson, 0);
  return [...hosts];
}

const GOV_SUFFIXES = [".gov", ".pr.gov", ".gov.pr", ".mil"];

export type TeachDomainDecision =
  | { ok: true; host: string; basis: "government" | "approved" | "admin"; allowedDomains: string[] }
  | { ok: false; reason: "invalid_url" | "not_https" | "not_allowed_host" | "not_approved"; message: { en: string; es: string } };

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase().replace(/^\*\./, "");
  return host === p || host.endsWith(`.${p}`);
}

export function approvedTeachHosts(env: string | undefined = process.env.TEACH_APPROVED_DOMAINS): string[] {
  const fromEnv = (env ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const fromConfigs = AGENCY_FILING_CONFIGS.flatMap((c) => c.domains.map((d) => d.toLowerCase()));
  return [...new Set([...fromEnv, ...fromConfigs, ...catalogPortalHosts()])];
}

export function isGovernmentHost(host: string): boolean {
  return GOV_SUFFIXES.some((s) => host.endsWith(s));
}

export function teachDomainDecision(
  startUrl: string,
  opts: { isAdmin: boolean; approvedHosts?: string[] }
): TeachDomainDecision {
  let url: URL;
  try {
    url = new URL(startUrl.trim());
  } catch {
    return { ok: false, reason: "invalid_url", message: { en: "That doesn't look like a web address.", es: "Eso no parece una dirección web." } };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "not_https", message: { en: "The site must use https://.", es: "El sitio tiene que usar https://." } };
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) {
    return { ok: false, reason: "not_allowed_host", message: { en: "Use the agency's public web address.", es: "Usa la dirección web pública de la agencia." } };
  }
  // Navigation stays on this site and on government sites (logins often
  // bounce through a shared gov sign-in host).
  const allowedDomains = [host, `*.${host}`, ...GOV_SUFFIXES.map((s) => `*${s}`)];
  if (isGovernmentHost(host)) return { ok: true, host, basis: "government", allowedDomains };
  const approved = opts.approvedHosts ?? approvedTeachHosts();
  if (approved.some((p) => hostMatches(host, p))) return { ok: true, host, basis: "approved", allowedDomains };
  if (opts.isAdmin) return { ok: true, host, basis: "admin", allowedDomains };
  return {
    ok: false,
    reason: "not_approved",
    message: {
      en: "Clara can only learn on government sites. Ask the SmartPR team to approve this one.",
      es: "Clara solo aprende en sitios del gobierno. Pídele al equipo de SmartPR que apruebe este.",
    },
  };
}

/** Navigation check the worker applies (mirrored in Python). */
export function navigationAllowed(url: string, allowedDomains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedDomains.some((p) => hostMatches(host, p));
  } catch {
    return false;
  }
}
