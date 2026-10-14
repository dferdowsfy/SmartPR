// Human-readable hierarchy for a confirmed site: no raw geocoder string, no
// "United States". Pure presentation — the IntakeSite itself is unchanged.
//   "Almacenes AEE / Luma Energy, Palo Seco, Toa Baja, Puerto Rico, 00962, United States"
//   → primary "Palo Seco, Toa Baja" · secondary "Puerto Rico 00962" · place "Almacenes AEE / Luma Energy"

import { addressMunicipio } from "./municipios.ts";

export interface SiteAddressParts {
  primary: string;
  secondary: string;
  placeName: string | null;
  /** Street line when the geocoder returned one ("Calle Los Ramos 60"). */
  street: string | null;
}

const STREET_RE = /^(calle|c\/|avenida|ave\.?|av\.?|carretera|carr\.?|camino|paseo|urb\.?|urbanizaci[oó]n|pr-?\d|road|rd\.?|street|st\.?|km\b)/i;

const COUNTRY = /^(united states( of america)?|usa|us|estados unidos)$/i;
const TERRITORY = /^(puerto rico|pr)$/i;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// "Maleza Alta" / "Maleza Baja", "Sabana Abajo" / "Sabana Arriba": sibling
// barrios that share a stem and differ only by the qualifier.
const BARRIO_QUALIFIER = /^(.+?) (alta|alto|baja|bajo|arriba|abajo|norte|sur|este|oeste)$/;

/**
 * True when an address segment from the geocoder names a SIBLING barrio of
 * the official one ("Maleza Alta" while the official barrio layer places the
 * pin in "Maleza Baja"). The geocoder's text is only the matched address; the
 * official barrio layer is authoritative, so such a segment must never be
 * displayed as the site's barrio or place (live 2026-10-14, E6).
 */
export function contradictsOfficialBarrio(segment: string, officialBarrio: string | null | undefined): boolean {
  if (!officialBarrio) return false;
  const seg = norm(segment);
  const off = norm(officialBarrio);
  if (!seg || seg === off) return false;
  const a = seg.match(BARRIO_QUALIFIER);
  const b = off.match(BARRIO_QUALIFIER);
  if (a && b) return a[1] === b[1] && a[2] !== b[2];
  // "Maleza Alta" vs an official "Maleza": same stem, different barrio.
  if (a) return a[1] === off;
  if (b) return b[1] === seg;
  return false;
}

/**
 * The geocoder's address with any sibling-barrio segment replaced by the
 * official barrio, so labels agree with the location panel, map and
 * requirements. Other segments are kept verbatim.
 */
export function addressWithOfficialBarrio(address: string, officialBarrio: string | null | undefined): string {
  if (!officialBarrio) return address;
  return address
    .split(",")
    .map((seg) => (contradictsOfficialBarrio(seg.trim(), officialBarrio) ? seg.replace(seg.trim(), officialBarrio) : seg))
    .join(",");
}

export function siteAddressParts(site: {
  formatted_address: string | null;
  municipality: { name: string };
  barrio?: { name: string } | null;
}): SiteAddressParts {
  const muni = site.municipality.name;
  // A different municipio named by the geocoder is flagged in the report, never mixed into the address line.
  const otherMuni = addressMunicipio(site.formatted_address);
  const raw = site.formatted_address ?? "";
  const zip = raw.match(/\b(00[6-9]\d{2})(?:-\d{4})?\b/)?.[1] ?? null;
  const barrio = site.barrio && norm(site.barrio.name) !== norm(muni) ? site.barrio.name : null;
  const segs = raw
    .split(",")
    .map((s) => s.replace(/\b00[6-9]\d{2}(?:-\d{4})?\b/, "").replace(/\s+PR$/i, "").trim())
    .filter((s) => s && !COUNTRY.test(s) && !TERRITORY.test(s) && norm(s) !== norm(muni) && !(otherMuni && norm(s) === norm(otherMuni)) && !/^municipio de /i.test(s) && !(barrio && norm(s) === norm(barrio)) && !contradictsOfficialBarrio(s, barrio))
    // Census-style "X barrio" / "X Pueblo" duplicates of the municipio.
    .filter((s) => !norm(s).startsWith(`${norm(muni)} `));
  // A bare house number ("60") belongs to the street that follows it.
  if (segs.length > 1 && /^\d+[A-Za-z]?$/.test(segs[0]!)) segs.splice(0, 2, `${segs[1]} ${segs[0]}`);
  const meaningful = segs.filter((x) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(x));
  segs.length = 0;
  segs.push(...meaningful);
  const first = segs[0] ?? null;
  const isStreet = (x: string | null) => !!x && (STREET_RE.test(x) || /\d/.test(x));
  const primaryLead = barrio ?? first;
  return {
    primary: primaryLead ? `${primaryLead}, ${muni}` : muni,
    secondary: zip ? `Puerto Rico ${zip}` : "Puerto Rico",
    placeName: barrio && first && !isStreet(first) ? first : null,
    street: barrio && first && isStreet(first) ? first : null,
  };
}
