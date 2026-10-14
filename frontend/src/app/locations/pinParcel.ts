// ============================================================================
// ONE answer to "which parcel is the confirmed pin on?" (E7, live loop
// 2026-10-14). Two lookups describe the parcel at a pin:
//
//   /api/locations/layers  point layers — CRIM `parcel` result (falls back to
//                          the catastro label of the JP calificación polygon
//                          when CRIM has no numbered lot there or times out)
//   /api/locations/parcel  whole-parcel findings — the CRIM boundary
//
// The intake (Property & Site Report preview) read the second and the
// Requirements page (site pills) read the first, so the Rincón beachfront pin
// showed "no cadastral parcel / roadway" in one place and "Parcel
// 095-000-005-01" in the other. Every surface now asks this resolver, which
// weighs both and labels what the number is: a CRIM parcel, or a JP
// zoning-map label CRIM did not confirm. A pin on a roadway or water shows NO
// parcel number anywhere (the site-case consistency rule); "Move the pin onto
// your lot" (/api/locations/snap) offers the nearby numbered CRIM lots.
// Engineering consistency only: no regulatory rule here.
// ============================================================================

import { CATASTRO_RE, type SiteLayerResult, type SiteLayers } from "./layers.ts";
import type { ParcelFindings } from "./parcel.ts";

type Bi = { en: string; es: string };

export type PinParcelState =
  /** A numbered CRIM parcel (boundary from the parcel lookup, or CRIM's point answer). */
  | "parcel"
  /** CRIM has no numbered lot here (or did not answer); the number is the JP zoning-map polygon's label. */
  | "zoning_map_label"
  /** The pin is on a roadway (CRIM right-of-way polygon or JP VIAL). No parcel number is shown. */
  | "roadway"
  /** The pin is on a mapped water body. */
  | "water"
  /** CRIM answered: no parcel at this point. */
  | "none"
  | "unavailable"
  | "loading";

export interface PinParcel {
  state: PinParcelState;
  /** The parcel number to show, or null (always null on a roadway / water). */
  catastro: string | null;
  basis: "crim_boundary" | "crim_point" | "jp_zoning_map" | null;
  /** A CRIM parcel boundary is in hand (parcel-wide checks possible). */
  boundary: boolean;
  /** Short label for a pill / chip. */
  label: Bi;
  /** One plain sentence for a tooltip or notice. */
  detail: Bi;
}

const bi = (en: string, es: string): Bi => ({ en, es });

function jpLabel(layers: SiteLayers | null | undefined): string | null {
  const z = layers?.results.find((r) => r.layer === "zoning" || r.layer === "land_class");
  const v = typeof z?.attributes?.num_catast === "string" ? z.attributes.num_catast.trim() : null;
  // "000-000-000-00" is the JP placeholder on roads and water, not a lot.
  return v && CATASTRO_RE.test(v) && !/^0{3}-0{3}-0{3}-0+$/.test(v) ? v : null;
}

function jpRoadOrWater(layers: SiteLayers | null | undefined): "road" | "water" | null {
  for (const r of layers?.results ?? []) {
    if ((r.layer !== "zoning" && r.layer !== "land_class") || r.status !== "resolved") continue;
    const code = (r.code ?? "").toUpperCase();
    const name = (r.name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (code === "VIAL" || r.tags.includes("road") || /sistema vial/.test(name)) return "road";
    if (code === "AGUA" || r.tags.includes("water") || /cuerpo de agua/.test(name)) return "water";
  }
  return null;
}

function crimTipo(r: SiteLayerResult | undefined): string | null {
  return typeof r?.attributes?.TIPO === "string" ? r.attributes.TIPO : null;
}

/**
 * The parcel at the confirmed pin, from both lookups.
 * `parcel` must already be for this pin (callers drop stale findings);
 * `parcelLoading` says the whole-parcel lookup is still running.
 */
export function resolvePinParcel(layers: SiteLayers | null | undefined, parcel: ParcelFindings | null | undefined, opts: { parcelLoading?: boolean } = {}): PinParcel {
  const point = layers?.results.find((r) => r.layer === "parcel");
  const b = parcel?.boundary;
  // 1. A numbered CRIM parcel boundary at the pin.
  if (b?.value?.catastro) {
    return { state: "parcel", catastro: b.value.catastro, basis: "crim_boundary", boundary: true,
      label: bi(`Parcel · ${b.value.catastro}`, `Parcela · ${b.value.catastro}`),
      detail: bi("CRIM cadastral parcel identified, with its mapped boundary.", "Parcela catastral del CRIM identificada, con su límite mapeado.") };
  }
  // 2. CRIM's point answer has a numbered parcel (boundary not in hand yet).
  if (point?.status === "resolved" && point.retrieval !== "derived" && point.code) {
    return { state: "parcel", catastro: point.code, basis: "crim_point", boundary: false,
      label: bi(`Parcel · ${point.code}`, `Parcela · ${point.code}`),
      detail: bi("CRIM cadastral parcel identified at the pin.", "Parcela catastral del CRIM identificada en el pin.") };
  }
  // The nearest labelled parcel: the JP zoning-map polygon's catastro (also
  // what the point lookup borrowed when it fell back to JP).
  const nearest = (point?.status === "resolved" && point.retrieval === "derived" ? point.code : null) ?? jpLabel(layers);
  // 3. Roadway / water: CRIM right-of-way or water polygon (either lookup), or JP VIAL / AGUA at the pin.
  const tipo = crimTipo(point);
  const jp = jpRoadOrWater(layers);
  const road = b?.reason === "only_right_of_way_polygon_at_point" || (point?.status === "none" && tipo === "V") || jp === "road";
  const water = b?.reason === "only_water_polygon_at_point" || (point?.status === "none" && tipo === "A") || jp === "water";
  if (road && !water) {
    return { state: "roadway", catastro: null, basis: null, boundary: false,
      label: bi("Parcel · pin on a roadway", "Parcela · pin sobre una vía"),
      detail: bi("The pin is on a roadway, not on a numbered lot, so no parcel number applies. Move the pin onto the property.", "El pin está sobre una vía, no sobre un solar numerado, así que no aplica un número de parcela. Mueva el pin sobre la propiedad.") };
  }
  if (water) {
    return { state: "water", catastro: null, basis: null, boundary: false,
      label: bi("Parcel · pin on a water body", "Parcela · pin sobre un cuerpo de agua"),
      detail: bi("The pin is on a mapped water body, not on a land parcel. Move the pin onto the property.", "El pin está sobre un cuerpo de agua mapeado, no sobre una parcela de terreno. Mueva el pin sobre la propiedad.") };
  }
  // 4. A JP zoning-map label CRIM did not confirm.
  if (nearest) {
    return { state: "zoning_map_label", catastro: nearest, basis: "jp_zoning_map", boundary: false,
      label: bi(`Parcel · ${nearest} (JP zoning map)`, `Parcela · ${nearest} (mapa de calificación JP)`),
      detail: bi(`The JP zoning map labels this point with parcel ${nearest}. CRIM has not confirmed a numbered parcel boundary here, so confirm the number with CRIM.`, `El mapa de calificación de la JP rotula este punto con la parcela ${nearest}. El CRIM no ha confirmado un límite de parcela numerada aquí; confirme el número con el CRIM.`) };
  }
  if (opts.parcelLoading && !b) {
    return { state: "loading", catastro: null, basis: null, boundary: false, label: bi("Parcel · checking…", "Parcela · verificando…"), detail: bi("Checking the CRIM parcel at the pin.", "Verificando la parcela del CRIM en el pin.") };
  }
  if (b?.status === "none_mapped" || point?.status === "none") {
    return { state: "none", catastro: null, basis: null, boundary: false,
      label: bi("Parcel · none at this point", "Parcela · ninguna en este punto"),
      detail: bi("CRIM has no numbered parcel at this exact point. The pin may be between lots; move it onto the property.", "El CRIM no tiene una parcela numerada en este punto exacto. El pin puede estar entre solares; muévalo sobre la propiedad.") };
  }
  return { state: "unavailable", catastro: null, basis: null, boundary: false,
    label: bi("Parcel · not verified", "Parcela · no verificada"),
    detail: bi("The CRIM parcel source did not answer for this point.", "La fuente de parcelas del CRIM no respondió para este punto.") };
}
