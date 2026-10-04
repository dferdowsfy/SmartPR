// ============================================================================
// One project-location state for the intake: the CONFIRMED project site
// (authoritative for every location-dependent evaluation) and, separately,
// any PROPOSED location (from the description, a search, or a map change)
// that still needs the user to confirm the exact site.
//
// Pure — no React, no network. The intake keeps one ProjectLocationState and
// feeds it through these functions:
//
//   extractPromptLocations()  what places the description names, split into
//                             project-site mentions and incidental ones
//                             ("customers from Caguas", "I live in Ponce").
//   reconcilePrompt()         given the description and the confirmed site,
//                             what should the location section show?
//                             (nothing · proposal · area-only · conflict ·
//                             ambiguity)
//
// Rules (never broken here):
//   - A confirmed pin is never silently replaced, and never by a LESS precise
//     description (a municipio never overrides a pin).
//   - An area (municipio / barrio) is never treated as a confirmed site.
//   - "Keep selected property" makes the pin authoritative for that mention;
//     moving the pin later re-opens the question.
//   - Every confirmed change bumps `revision`; async results carry the
//     revision they were requested for and are dropped when it moved on.
// ============================================================================

import { mentionedAddress } from "./intakeLocation.ts";
import { normalizeMunicipio } from "./geo.ts";

export type LocationOrigin = "prompt" | "search" | "map_pin" | "saved_location" | "restored";
export type LocationPrecision = "parcel" | "point" | "address" | "barrio" | "municipality";

/** A place named in the description. */
export interface PromptPlace {
  /** Text as the user wrote it (original spelling preserved). */
  text: string;
  municipality: string | null;
  barrio: string | null;
  address: string | null;
  precision: Extract<LocationPrecision, "address" | "barrio" | "municipality">;
  /** Stable key for remembering the user's decision about this mention. */
  key: string;
}

export interface PromptPlaces {
  project: PromptPlace[];
  /** Customer areas, owner/home/mailing addresses, origins — never a relocation. */
  incidental: PromptPlace[];
}

/** The confirmed site, as far as reconciliation needs to know it. */
export interface ConfirmedSiteRef {
  municipality: string;
  barrio: string | null;
  formatted_address: string | null;
  latitude: number;
  longitude: number;
  origin: LocationOrigin;
}

export interface ProjectLocationState {
  /** Bumped on every confirmed-site change (and on clear). */
  revision: number;
  /** "<mention key>@<site key>" the user resolved with "Keep selected property". */
  kept: string[];
  /** Mention keys the user dismissed while no site was confirmed. */
  dismissed: string[];
  /** Mention the user chose to use: its proposal is open on the map until confirmed. */
  adopting: PromptPlace | null;
}

export const initialLocationState = (): ProjectLocationState => ({ revision: 0, kept: [], dismissed: [], adopting: null });

export type LocationPrompt =
  | { kind: "none" }
  /** Description agrees with the confirmed site (or adds nothing more precise). */
  | { kind: "agrees"; place: PromptPlace }
  /** No confirmed site: a specific address was named — propose it, confirm the exact site. */
  | { kind: "propose"; place: PromptPlace }
  /** No confirmed site: only an area was named — show it, ask for the exact property. */
  | { kind: "area_only"; place: PromptPlace }
  /** Confirmed site elsewhere than the description says. */
  | { kind: "conflict"; place: PromptPlace; current: string }
  /** Several possible project sites: ask which. */
  | { kind: "ambiguous"; places: PromptPlace[] };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Words just before a place name that make it incidental (not the project site).
const INCIDENTAL_BEFORE =
  /\b(customers?|clients?|clientes?|consumers?|patients?|pacientes?|serv(?:e|es|ing|ice|ices|imos|ir|icio)|deliver(?:y|ies|ing)?|entregas?|reparto|visitors?|tourists?|turistas?|suppliers?|suplidores?|proveedores?|owner|due[nñ]o|i live|we live|lives|vivo|vivimos|vive|home address|mailing address|direcci[oó]n postal|postal|residencia|resident|originally|born|nac[ií]|from|desde|de toda|across|throughout|all over|toda la isla|around|alrededor|cerca de mi casa|near my home|commute|travel(?:s|ing)? to|viaj\w*|headquarter(?:s|ed)?|oficina central|sede|our other|nuestra otra|currently|actualmente|used to|before|antes|previous(?:ly)?|old)\b[^.;\n]{0,32}$/i;
// Strong cues that the place is where the project happens ("in"/"en"/"at"
// alone are neutral: "I live in Ponce").
const PROJECT_BEFORE =
  /\b(located|ubicad[oa]|localizad[oa]|situad[oa]|open(?:ing)?|abrir|abrimos|property|propiedad|local|lot|lote|solar|site|terreno|build(?:ing)?|construir|remodel\w*|renovat\w*|move to|mudar\w*|relocat\w*|traslad\w*)\b[^.;\n]{0,24}$/i;

function mentionsOf(text: string, names: readonly string[]): Array<{ name: string; at: number; end: number }> {
  const hay = fold(text);
  const out: Array<{ name: string; at: number; end: number }> = [];
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const taken: Array<[number, number]> = [];
  for (const name of sorted) {
    const needle = fold(name);
    if (needle.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?=$|[^a-z0-9])`, "g");
    for (let m = re.exec(hay); m; m = re.exec(hay)) {
      const at = m.index + m[1]!.length;
      const end = at + m[0].length - m[1]!.length;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      taken.push([at, end]);
      out.push({ name, at, end });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const BARRIO_RE = /\b(?:barrio|bo\.?|sector)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ-]*(?:\s+(?:de\s+|del\s+|la\s+|las\s+|los\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ-]*){0,3})/g;

/**
 * Places named in the description. Each municipio occurrence is classified
 * by its context; a street address / barrio attaches to the nearest
 * municipio mention after it (or stands alone).
 */
export function extractPromptLocations(description: string | null | undefined, municipalityNames: readonly string[]): PromptPlaces {
  const text = description ?? "";
  const out: PromptPlaces = { project: [], incidental: [] };
  if (!text.trim()) return out;
  const rawAddress = mentionedAddress(text);
  // "barrio X" / "Bo. X" / "sector X" is an area, not a street address.
  const address = rawAddress && /^(barrio|bo\.?|sector)\b/i.test(rawAddress) ? null : rawAddress;
  const addressAt = address ? text.indexOf(address) : -1;
  const barrios: Array<{ name: string; at: number }> = [];
  for (const m of text.matchAll(BARRIO_RE)) {
    // "barrio Quebrada Infierno de Gurabo" → the barrio stops before its municipio.
    let name = m[1]!.trim();
    for (const muni of municipalityNames) {
      const cut = new RegExp(`\\s+(?:de|del|in|en)?\\s*${fold(muni).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
      const f = fold(name);
      const hit = f.match(cut);
      if (hit && hit.index! > 0) { name = name.slice(0, hit.index); break; }
    }
    barrios.push({ name: name.trim(), at: m.index ?? 0 });
  }

  const isIncidental = (at: number) => {
    const clause = Math.max(text.lastIndexOf(".", at - 1), text.lastIndexOf(";", at - 1), text.lastIndexOf("\n", at - 1));
    const before = text.slice(Math.max(0, clause + 1, at - 60), at);
    const inc = before.search(INCIDENTAL_BEFORE);
    if (inc < 0) return false;
    // "customers from Gurabo who want us to open a store in …": a strong
    // project cue AFTER the incidental cue governs the place.
    return !PROJECT_BEFORE.test(before.slice(inc + 1));
  };

  const mentions = mentionsOf(text, municipalityNames);
  const used = new Set<number>();
  const push = (p: Omit<PromptPlace, "key">, incidental: boolean) => {
    const key = fold([p.address, p.barrio, p.municipality].filter(Boolean).join("|"));
    const list = incidental ? out.incidental : out.project;
    if (!list.some((x) => x.key === key)) list.push({ ...p, key });
  };
  for (const m of mentions) {
    // A municipio name inside the street address ("Calle Loíza") is part of the address.
    if (address && addressAt >= 0 && m.at >= addressAt && m.end <= addressAt + address.length) continue;
    const incidental = isIncidental(m.at);
    const nearAddress = address && addressAt >= 0 && addressAt < m.at && m.at - (addressAt + address.length) < 40 && !incidental;
    const barrio = barrios.find((b) => b.at < m.at && m.at - b.at < 60 && fold(b.name) !== fold(m.name));
    if (nearAddress) used.add(addressAt);
    push(
      {
        text: text.slice(nearAddress ? addressAt : barrio ? barrio.at : m.at, m.end),
        municipality: m.name,
        barrio: barrio?.name ?? null,
        address: nearAddress ? address : null,
        precision: nearAddress ? "address" : barrio ? "barrio" : "municipality",
      },
      incidental
    );
  }
  if (address && addressAt >= 0 && !used.has(addressAt) && !isIncidental(addressAt)) {
    // An address without a municipio name: a proposal still needs the map.
    const already = out.project.find((p) => p.address === address);
    if (!already) push({ text: address, municipality: null, barrio: null, address, precision: "address" }, false);
  }
  return out;
}

const siteKey = (s: ConfirmedSiteRef) => `${s.latitude.toFixed(6)},${s.longitude.toFixed(6)}`;

/** Street words of an address, for "is this the same street?" */
function streetWords(addr: string | null | undefined): string[] {
  return fold(addr ?? "")
    .replace(/\b(calle|c\/|avenida|ave|av|carretera|carr|camino|paseo|urb|urbanizacion|street|st|road|rd|avenue|blvd|pr|km|no|num|#)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}

const placeLabel = (p: PromptPlace) => p.text.trim() || [p.address, p.barrio, p.municipality].filter(Boolean).join(", ");
export const siteRefLabel = (s: ConfirmedSiteRef) =>
  s.barrio && fold(s.barrio) !== fold(s.municipality) ? `${s.barrio}, ${s.municipality}` : s.municipality;

/**
 * What the location section should show for this description and site.
 * Ignores incidental mentions. Never proposes replacing a confirmed site with
 * a less precise place.
 */
export function reconcilePrompt(
  places: PromptPlaces,
  confirmed: ConfirmedSiteRef | null,
  state: ProjectLocationState
): LocationPrompt {
  // Distinct project sites (a municipio + an address in it count once).
  const project = places.project.filter((p, _, all) => !(p.precision === "municipality" && all.some((q) => q !== p && q.municipality && normalizeMunicipio(q.municipality) === normalizeMunicipio(p.municipality ?? ""))));
  if (!project.length) return { kind: "none" };

  if (!confirmed) {
    const open = project.filter((p) => !state.dismissed.includes(p.key));
    if (!open.length) return { kind: "none" };
    if (open.length > 1) return { kind: "ambiguous", places: open };
    const place = open[0]!;
    return place.precision === "address" ? { kind: "propose", place } : { kind: "area_only", place };
  }

  const sameMuni = (p: PromptPlace) => !p.municipality || normalizeMunicipio(p.municipality) === normalizeMunicipio(confirmed.municipality);
  const differs = (p: PromptPlace) => {
    if (!sameMuni(p)) return true;
    if (p.barrio && confirmed.barrio && fold(p.barrio) !== fold(confirmed.barrio)) return true;
    if (p.address && confirmed.formatted_address) {
      const want = streetWords(p.address);
      const have = new Set(streetWords(confirmed.formatted_address));
      // A named street that the confirmed address doesn't share is a different site.
      return want.length > 0 && !want.some((w) => have.has(w));
    }
    return false;
  };
  const kept = (p: PromptPlace) => state.kept.includes(`${p.key}@${siteKey(confirmed)}`);
  const conflicting = project.filter((p) => differs(p) && !kept(p));
  if (conflicting.length > 1) return { kind: "ambiguous", places: conflicting };
  if (conflicting.length === 1) return { kind: "conflict", place: conflicting[0]!, current: siteRefLabel(confirmed) };
  return { kind: "agrees", place: project[0]! };
}

// ---------------------------------------------------------------------------
// State transitions (all pure)
// ---------------------------------------------------------------------------

/** The confirmed site changed (confirm, edit, clear): bump the revision, end any adoption. */
export function onConfirmedChange(state: ProjectLocationState): ProjectLocationState {
  return { ...state, revision: state.revision + 1, adopting: null };
}

/** "Keep selected property": the pin stays authoritative for this mention. */
export function keepSelected(state: ProjectLocationState, place: PromptPlace, confirmed: ConfirmedSiteRef): ProjectLocationState {
  const k = `${place.key}@${siteKey(confirmed)}`;
  return { ...state, kept: state.kept.includes(k) ? state.kept : [...state.kept, k], adopting: null };
}

/** "Use location from description": open it as a proposal; the confirmed site stays until the user confirms the exact site. */
export function adoptPromptPlace(state: ProjectLocationState, place: PromptPlace): ProjectLocationState {
  return { ...state, adopting: place };
}

/** Cancel / dismiss a proposal: the previous confirmed site (if any) stays as it was. */
export function dismissProposal(state: ProjectLocationState, place: PromptPlace | null): ProjectLocationState {
  return { ...state, adopting: null, dismissed: place && !state.dismissed.includes(place.key) ? [...state.dismissed, place.key] : state.dismissed };
}

/** True when an async answer requested at `revision` still belongs to the current site. */
export const isCurrentRevision = (state: ProjectLocationState, revision: number) => state.revision === revision;

/** Map-search text for a prompt place. */
export function placeQuery(p: PromptPlace): string {
  const parts = [p.address, p.barrio ? `Barrio ${p.barrio}` : null, p.municipality].filter(Boolean) as string[];
  return `${parts.join(", ")}, Puerto Rico`;
}

export { placeLabel };

/** Defensive restore (intake snapshot). */
export function restoreLocationState(raw: unknown): ProjectLocationState {
  if (!raw || typeof raw !== "object") return initialLocationState();
  const s = raw as Partial<ProjectLocationState>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : []);
  return { revision: Number.isFinite(s.revision) ? Number(s.revision) : 0, kept: strs(s.kept), dismissed: strs(s.dismissed), adopting: null };
}
