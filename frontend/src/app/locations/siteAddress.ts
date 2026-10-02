// Human-readable hierarchy for a confirmed site: no raw geocoder string, no
// "United States". Pure presentation — the IntakeSite itself is unchanged.
//   "Almacenes AEE / Luma Energy, Palo Seco, Toa Baja, Puerto Rico, 00962, United States"
//   → primary "Palo Seco, Toa Baja" · secondary "Puerto Rico 00962" · place "Almacenes AEE / Luma Energy"

export interface SiteAddressParts {
  primary: string;
  secondary: string;
  placeName: string | null;
}

const COUNTRY = /^(united states( of america)?|usa|us|estados unidos)$/i;
const TERRITORY = /^(puerto rico|pr)$/i;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function siteAddressParts(site: {
  formatted_address: string | null;
  municipality: { name: string };
  barrio?: { name: string } | null;
}): SiteAddressParts {
  const muni = site.municipality.name;
  const raw = site.formatted_address ?? "";
  const zip = raw.match(/\b(00[6-9]\d{2})(?:-\d{4})?\b/)?.[1] ?? null;
  const barrio = site.barrio && norm(site.barrio.name) !== norm(muni) ? site.barrio.name : null;
  const segs = raw
    .split(",")
    .map((s) => s.replace(/\b00[6-9]\d{2}(?:-\d{4})?\b/, "").replace(/\s+PR$/i, "").trim())
    .filter((s) => s && !COUNTRY.test(s) && !TERRITORY.test(s) && norm(s) !== norm(muni) && !/^municipio de /i.test(s) && !(barrio && norm(s) === norm(barrio)))
    // Census-style "X barrio" / "X Pueblo" duplicates of the municipio.
    .filter((s) => !norm(s).startsWith(`${norm(muni)} `));
  const first = segs[0] ?? null;
  const primaryLead = barrio ?? first;
  return {
    primary: primaryLead ? `${primaryLead}, ${muni}` : muni,
    secondary: zip ? `Puerto Rico ${zip}` : "Puerto Rico",
    placeName: barrio && first ? first : null,
  };
}
