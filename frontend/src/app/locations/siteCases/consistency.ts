// ============================================================================
// Property & Site Report consistency — every output built from ONE sample
// case, then the facts each output states are diffed against each other and
// against the official facts read straight from the recorded responses.
//
// Outputs covered (the same ones a user sees or takes away):
//   selection card / map   site point, municipality, catastro, highlighted lot
//   pin panel              SiteLayerChips → SiteIntelligencePanel (pin layers)
//   preview chips          SiteReportPreview
//   drawer                 PropertyReportDrawer (full report on screen)
//   copied summary         reportSummaryText (EN + ES) — "Copy summary"
//   full report export     JSON download (report + professional_review)
//   PDF export             renderPropertyReportPdf (EN + ES), text read back
//   Passport copy          restorePropertyReport(JSON round trip)
// No network: the fixture answers every request (replayNetwork).
// ============================================================================

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPropertyReport, reportSummaryText, restorePropertyReport, type PropertyReport, type ReportFinding } from "../propertyReport.ts";
import { pdfSafeText, renderPropertyReportPdf } from "../propertyReportPdf.ts";
import { locateInPuertoRico } from "../boundaries.ts";
import { CATASTRO_RE, floodMapSummary } from "../layers.ts";
import type { IntakeSite } from "../intakeLocation.ts";
import { officialFacts, type OfficialFacts } from "./officialFacts.ts";
import { replayNetwork, runSitePipeline, type PipelineResult, type SiteFixture } from "./pipeline.ts";
import type { SiteCase } from "./cases.ts";
import Module from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// The UI components pull in maplibre's stylesheet; outside a bundler a .css
// import is just ignored (components are loaded lazily, after this hook).
const exts = (Module as unknown as { _extensions?: Record<string, (m: { exports: unknown }) => void> })._extensions;
if (exts && !exts[".css"]) exts[".css"] = (m) => { m.exports = {}; };
async function components() {
  const req = Module.createRequire(import.meta.url);
  const { SiteReportPreview } = req("../../components/intake/SiteReportPreview.tsx") as typeof import("../../components/intake/SiteReportPreview.tsx");
  const { PropertyReportDrawer } = req("../../components/intake/PropertyReportDrawer.tsx") as typeof import("../../components/intake/PropertyReportDrawer.tsx");
  const { SiteLayerChips } = req("../../components/intake/LocationStepCard.tsx") as typeof import("../../components/intake/LocationStepCard.tsx");
  return { SiteReportPreview, PropertyReportDrawer, SiteLayerChips };
}

export interface CaseOutputs {
  summary: { en: string; es: string };
  json: string;
  passport: PropertyReport | null;
  pdf: { en: string; es: string };
  preview: { en: string; es: string };
  drawer: string;
  pinPanel: string;
  map: { point: { latitude: number; longitude: number }; parcel: unknown | null };
}

export interface CaseRun {
  c: SiteCase;
  fx: SiteFixture;
  official: OfficialFacts;
  pipeline: PipelineResult;
  site: IntakeSite;
  report: PropertyReport;
  outputs: CaseOutputs;
  /** URLs the code asked for that the fixture does not have (must be empty). */
  unrecorded: string[];
}

export interface Issue {
  case: string;
  output: string;
  fact: string;
  expected: string;
  actual: string;
}

// ---------------------------------------------------------------------------

/** HTML → visible text (entities decoded). */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

/** Text of a PDF (pdfjs-dist, Node legacy build). */
export async function pdfText(buf: ArrayBuffer): Promise<string> {
  const req = Module.createRequire(import.meta.url);
  // Absolute file URL: pdfjs ships ESM only.
  const pdfjs = (await import(pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href)) as typeof import("pdfjs-dist");
  const fonts = `${dirname(req.resolve("pdfjs-dist/package.json"))}/standard_fonts/`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), standardFontDataUrl: fonts, disableFontFace: true, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push(tc.items.map((x) => ("str" in x ? x.str : "")).join(" "));
  }
  await pdf.destroy();
  return out.join("\n");
}

const squash = (s: string) => s.replace(/\s+/g, "");

export function siteFromFixture(c: SiteCase, fx: SiteFixture, layers: PipelineResult["layers"]): IntakeSite {
  const place = locateInPuertoRico(c.latitude, c.longitude);
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    coordinate_source: "MAP_PIN",
    formatted_address: fx.address?.formatted_address ?? null,
    municipality: { name: place?.municipio.name ?? "", fips: place?.municipio.fips ?? null },
    barrio: place?.barrio ? { name: place.barrio.name, geoid: place.barrio.geoid } : null,
    near_boundary: place?.nearBoundary ?? false,
    designations: [],
    boundary_source: null,
    location_id: null,
    confirmed_at: fx.captured_at,
    layers,
  };
}

export async function runCase(c: SiteCase, fx: SiteFixture): Promise<CaseRun> {
  const net = replayNetwork(fx);
  const now = new Date(fx.captured_at);
  const pipeline = await runSitePipeline(c, net, { now, withSnap: !!c.offLot });
  const site = siteFromFixture(c, fx, pipeline.layers);
  const report = buildPropertyReport({ site, parcel: pipeline.parcel, revision: 1, context: { activity: null, businessType: null, projectTypes: [], locationRequirements: [] }, now });
  const noop = () => undefined;
  const { SiteReportPreview, PropertyReportDrawer, SiteLayerChips } = await components();
  const preview = (lang: "en" | "es") => htmlText(renderToStaticMarkup(createElement(SiteReportPreview, { report, lang, onOpen: noop })));
  const drawer = htmlText(renderToStaticMarkup(createElement(PropertyReportDrawer, { open: true, report, lang: "en", onClose: noop, onEditLocation: noop, passport: { kind: "signed_out" } })));
  const pinPanel = htmlText(renderToStaticMarkup(createElement(SiteLayerChips, { site, lang: "en" })));
  const pdf = async (lang: "en" | "es") => pdfText((await renderPropertyReportPdf(report, lang, null)).output("arraybuffer"));
  const json = JSON.stringify({ ...report, professional_review: null }, null, 2);
  return {
    c, fx, official: officialFacts(fx), pipeline, site, report, unrecorded: net.missing,
    outputs: {
      summary: { en: reportSummaryText(report, "en"), es: reportSummaryText(report, "es") },
      json,
      passport: restorePropertyReport(JSON.parse(JSON.stringify(report))),
      pdf: { en: await pdf("en"), es: await pdf("es") },
      preview: { en: preview("en"), es: preview("es") },
      drawer,
      pinPanel,
      // What ProjectLocationCard hands PassportMap once the site is confirmed.
      map: { point: { latitude: site.latitude, longitude: site.longitude }, parcel: report.property.boundary.geometry },
    },
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > lat) !== (yj! > lat) && lng < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}
const firstRing = (g: unknown): number[][] | null => {
  const x = g as { type?: string; coordinates?: unknown } | null;
  if (!x?.coordinates) return null;
  return x.type === "Polygon" ? (x.coordinates as number[][][])[0] ?? null : (x.coordinates as number[][][][])[0]?.[0] ?? null;
};
const CATASTRO_ANY = /\b\d{3}-\d{3}-\d{3}-[0-9A-Z]{2,3}\b/g;

/** Zone tokens of a flood value ("Zone X 84.2% · X (0.2%) 13.6% · AE 2.2%" → ["X", "X (0.2%)", "AE"]). */
export function floodValueTokens(v: string): string[] {
  return v.replace(/^(Zone|Zona)\s+/, "").split(" · ").map((t) => t.replace(/\s+\d+(\.\d+)?%.*$/, "").replace(/\s+\((small|pequeña)\)$/, "").replace(/\s+\((area not measured|área no medida)\)$/, "").trim()).filter(Boolean);
}

export function checkCase(run: CaseRun): Issue[] {
  const { c, official: o, report: r, outputs: out } = run;
  const issues: Issue[] = [];
  const bad = (output: string, fact: string, expected: unknown, actual: unknown) => issues.push({ case: c.id, output, fact, expected: String(expected), actual: String(actual) });
  const F = (id: string) => r.findings.find((f) => f.id === id);
  const texts: Array<[string, string, "en" | "es"]> = [["summary", out.summary.en, "en"], ["summary_es", out.summary.es, "es"], ["pdf", out.pdf.en, "en"], ["pdf_es", out.pdf.es, "es"], ["drawer", out.drawer, "en"]];
  const contains = (hay: string, needle: string, isPdf: boolean) => squash(hay).includes(squash(isPdf ? pdfSafeText(needle) : needle));

  if (run.unrecorded.length) bad("fixture", "every request replayed from the record", "0 unrecorded", run.unrecorded.slice(0, 3).join(" | "));

  // ---- Selected property: point, municipality, address ----------------------------------
  const coord = `${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}`;
  if (r.property.latitude !== c.latitude || r.property.longitude !== c.longitude) bad("report", "coordinates", coord, `${r.property.latitude}, ${r.property.longitude}`);
  if (out.map.point.latitude !== c.latitude || out.map.point.longitude !== c.longitude) bad("map", "pin", coord, `${out.map.point.latitude}, ${out.map.point.longitude}`);
  for (const [name, t] of [["summary", out.summary.en], ["summary_es", out.summary.es], ["pdf", out.pdf.en], ["pdf_es", out.pdf.es], ["drawer", out.drawer]] as const) {
    if (!contains(t, coord, name.startsWith("pdf"))) bad(name, "coordinates shown", coord, "missing");
  }
  if (r.property.municipality !== c.municipality) bad("report", "municipality (Census)", c.municipality, r.property.municipality);
  for (const [name, t] of texts) if (!contains(t, r.property.municipality, name.startsWith("pdf"))) bad(name, "municipality shown", r.property.municipality, "missing");
  const addrMuni = run.fx.address?.municipality ?? null;
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (addrMuni && fold(addrMuni) !== fold(r.property.municipality)) {
    const flagged = r.property.location?.notices.some((n) => fold(n.en).includes(fold(addrMuni))) ?? false;
    if (!flagged) bad("report", "address municipality agrees with the pin (or the difference is shown)", r.property.municipality, `address says ${addrMuni}, not flagged`);
  }
  const primary = r.property.address.primary;
  for (const [name, t] of texts) if (!contains(t, primary, name.startsWith("pdf"))) bad(name, "address shown", primary, "missing");
  if (addrMuni && fold(primary).includes(", ") && primary.split(", ").filter((p) => fold(p) !== fold(r.property.municipality)).some((p) => fold(p) === fold(addrMuni))) bad("report", "address has one municipality", r.property.municipality, primary);

  // ---- Parcel ID + highlighted lot ------------------------------------------------------
  const crimLot = o.crim.catastro && (o.crim.tipo ?? "P") !== "V" && (o.crim.tipo ?? "P") !== "A" ? o.crim.catastro : null;
  const expectedCat = crimLot;
  if ((r.property.catastro.value ?? null) !== expectedCat) bad("report", "catastro (CRIM at the pin)", expectedCat ?? "none", r.property.catastro.value ?? "none");
  if (c.expect.parcel !== (o.crim.catastro && o.crim.tipo === "P" ? o.crim.catastro : null) && c.expect.parcel !== expectedCat) bad("cases.ts", "case label matches the record", c.expect.parcel ?? "none", expectedCat ?? "none");
  const ring = firstRing(out.map.parcel);
  if (expectedCat) {
    for (const [name, t] of texts) if (!contains(t, expectedCat, name.startsWith("pdf"))) bad(name, "catastro shown", expectedCat, "missing");
    if (!ring) bad("map", "highlighted lot", `CRIM boundary of ${expectedCat}`, "no geometry");
    else {
      if (!pointInRing(c.longitude, c.latitude, ring)) bad("map", "highlighted lot contains the pin", "pin inside lot", "pin outside lot");
      if (o.crim.ring && JSON.stringify(o.crim.ring) !== JSON.stringify(ring)) bad("map", "highlighted lot = CRIM polygon at the pin", `${o.crim.ring.length} vertices`, `${ring.length} vertices`);
    }
  } else {
    if (ring) bad("map", "no lot highlighted off-lot", "none", `${ring.length}-vertex polygon`);
    for (const [name, t] of texts) {
      const ids = [...new Set(t.match(CATASTRO_ANY) ?? [])];
      if (ids.length) bad(name, "no parcel ID shown when the pin is not on a numbered lot", "none", ids.join(", "));
    }
  }
  // CRIM and the JP calificación record name the same lot (when both carry one).
  if (crimLot && o.jp.num_catast && CATASTRO_RE.test(o.jp.num_catast) && o.jp.num_catast !== crimLot) {
    const flagged = (r.discrepancies ?? []).some((d) => d.en.includes(o.jp.num_catast!));
    if (!flagged) bad("report", "CRIM vs JP catastro discrepancy surfaced", `${crimLot} vs JP ${o.jp.num_catast} flagged`, "not flagged");
  }

  // ---- Off-lot handling --------------------------------------------------------------------
  const loc = r.property.location;
  if (c.offLot === "road" && !loc?.roadway) bad("report", "roadway pin flagged", "roadway notice", "none");
  if (c.offLot === "water") {
    const flagged = loc?.notices.some((n) => /water/i.test(n.en)) ?? false;
    if (!flagged) bad("report", "water pin flagged", "water-body notice", (loc?.notices ?? []).map((n) => n.en).join(" | ") || "none");
    if (F("permitted_uses")?.value && !/not evaluated/i.test(F("permitted_uses")!.value!.en)) bad("report", "no use analysis on a water body", "not evaluated", F("permitted_uses")!.value!.en);
  }
  if (c.offLot && loc && !loc.preliminary) bad("report", "off-lot report is preliminary", "preliminary", "not preliminary");
  if (c.offLot && !out.preview.en.includes(loc?.notices[0]?.en ?? "\u0000")) bad("preview", "off-lot notice in the preview", loc?.notices[0]?.en ?? "(notice)", "missing");

  // ---- Zoning ------------------------------------------------------------------------------
  const z = F("zoning")!;
  const zParts = z.coverage?.parts.map((p) => p.key) ?? [];
  if (o.jp.answered && o.jp.cali && !c.offLot) {
    const pinVal = z.pin?.value.en ?? z.value?.en ?? "";
    if (!pinVal.startsWith(o.jp.cali)) bad("report", "zoning at the pin", o.jp.cali, pinVal || z.state);
    if (z.scope === "parcel") {
      const extra = zParts.filter((k) => !o.jpParcel.districts.includes(k));
      const missing = o.jpParcel.districts.filter((k) => !zParts.includes(k) && !(z.coverage?.contacts ?? []).includes(k));
      if (extra.length || missing.length) bad("report", "parcel zoning districts = JP polygons on the lot", o.jpParcel.districts.join(","), `${zParts.join(",")} (contacts ${(z.coverage?.contacts ?? []).join(",")})`);
    }
  }
  if (z.value) for (const [name, t, lang] of texts) if (!contains(t, (lang === "es" ? z.value.es : z.value.en), name.startsWith("pdf"))) bad(name, "zoning value shown", z.value[lang], "missing");
  const lc = F("land_class")!;
  if (o.jp.clasi && !c.offLot && !(lc.value?.en ?? "").startsWith(o.jp.clasi)) bad("report", "land class at the pin", o.jp.clasi, lc.value?.en ?? lc.state);
  const zDate = z.sources[0]?.dataset_date ?? null;
  if (o.jp.vigencia && z.state === "sourced" && !c.offLot) {
    const v = o.jp.vigencia;
    const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
    if (!zDate) bad("report", "zoning source date (JP vigencia)", v, "none");
    else if (iso && zDate !== iso) bad("report", "zoning source date (JP vigencia)", iso, zDate);
  }

  // ---- Flood -------------------------------------------------------------------------------
  const fl = F("flood_zone")!;
  const fm = floodMapSummary(run.pipeline.layers);
  if (o.fema.answered && o.fema.governing) {
    if (fm?.zone !== o.fema.governing) bad("pin layers", "FEMA zone at the pin", o.fema.governing, fm?.zone ?? "none");
    const shownPin = fl.pin?.value.en ?? (fl.scope === "point" ? fl.value?.en : null);
    if (shownPin && !new RegExp(`^Zone ${o.fema.governing}\\b`).test(shownPin)) bad("report", "flood zone at the pin", `Zone ${o.fema.governing}`, shownPin);
    if (!out.pinPanel.includes(`Zone ${o.fema.governing}`)) bad("pin panel", "FEMA zone at the pin", `Zone ${o.fema.governing}`, "missing");
    if (o.fema.panel && fm?.firmPanel !== o.fema.panel) bad("pin layers", "FIRM panel", o.fema.panel, fm?.firmPanel ?? "none");
    if (o.fema.effective && fl.sources[0]?.dataset_date !== o.fema.effective) bad("report", "FIRM effective date on the flood source", o.fema.effective, fl.sources[0]?.dataset_date ?? "none");
  }
  if (fl.value) {
    const toks = floodValueTokens(fl.value.en);
    if (new Set(toks).size !== toks.length) bad("report", "flood value lists each zone once", [...new Set(toks)].join(" · "), fl.value.en);
    for (const [name, t, lang] of texts) if (!contains(t, fl.value[lang], name.startsWith("pdf"))) bad(name, "flood value shown", fl.value[lang], "missing");
    const chip = out.preview.en.match(/FEMA Zone [^·]*(· [^·]+)*/)?.[0] ?? null;
    if (chip) {
      const zonesInChip = (chip.match(/\b(AE|AO|AH|A|VE|V|X|D)\b(?: \(0\.2%\))?/g) ?? []);
      const counts = zonesInChip.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
      // The pill names the governing zone once; the value lists every zone once.
      if (Object.values(counts).some((n) => n > 2)) bad("preview", "flood chip repeats a zone", "each zone once in the value", chip);
    }
  }
  if (fl.scope === "parcel" && o.femaParcel.answered) {
    const raw = (fl.coverage?.raw_parts ?? fl.coverage?.parts ?? []).map((p) => p.key);
    const contacts = fl.coverage?.contacts ?? [];
    const extra = raw.filter((k) => !o.femaParcel.keys.includes(k));
    const missing = o.femaParcel.keys.filter((k) => !raw.includes(k) && !contacts.includes(k));
    if (extra.length || missing.length) bad("report", "parcel flood zones = FEMA polygons on the lot", o.femaParcel.keys.join(","), `${raw.join(",")} (contacts ${contacts.join(",")})`);
    const sfhaParcel = raw.some((k) => /^(A|V)/.test(k));
    if (sfhaParcel !== (fl.tone === "hazard")) bad("report", "flood tone = SFHA on the parcel", sfhaParcel ? "hazard" : "not hazard", fl.tone);
    const worst = [...raw, ...(fm ? [`${fm.zone}|`] : [])].sort((a, b) => (/^V/.test(b) ? 3 : /^A/.test(b) ? 2 : 0) - (/^V/.test(a) ? 3 : /^A/.test(a) ? 2 : 0))[0]?.split("|")[0];
    if (worst && /^(A|V)/.test(worst) && !(fl.pill?.en ?? "").includes(`Zone ${worst}`)) bad("report", "flood pill names the most hazardous zone", `Zone ${worst}`, fl.pill?.en ?? "none");
  }
  const fw = F("floodway")!;
  const fwOfficial = o.fema.floodway || (fl.scope === "parcel" && o.femaParcel.keys.some((k) => /FLOODWAY/i.test(k)));
  if (o.fema.answered && (fw.state === "sourced") !== fwOfficial) bad("report", "regulatory floodway", fwOfficial ? "mapped" : "none mapped", fw.value?.en ?? fw.state);
  const adv = F("flood_advisory")!;
  if (o.advisory.answered) {
    if (o.advisory.zone) {
      if (!(adv.value?.en ?? "").includes(o.advisory.zone)) bad("report", "advisory (ABFE) zone at the pin", o.advisory.zone, adv.value?.en ?? adv.state);
      const advSfha = /^(A|V)/.test(o.advisory.zone);
      const firmSfha = !!o.fema.governing && /^(A|V)/.test(o.fema.governing);
      if (advSfha && !firmSfha && !(r.discrepancies ?? []).some((d) => /advisory/i.test(d.en))) bad("report", "advisory SFHA vs effective FIRM non-SFHA surfaced", "discrepancy listed", "not listed");
    } else if (adv.state !== "none_mapped" && !(o.advisory.in02 && adv.state === "sourced")) bad("report", "advisory answered: none mapped", "none mapped", adv.state);
  }

  // ---- Coastal zone --------------------------------------------------------------------------
  const cz = F("coastal_zone")!;
  if (o.coastal.answered) {
    const inside = cz.state === "sourced";
    if (inside !== o.coastal.inside) bad("report", "coastal zone (NOAA CZMA)", o.coastal.inside ? "inside" : "outside", cz.value?.en ?? cz.state);
  }

  // ---- Sources, dates, retrieved-at ---------------------------------------------------------
  for (const f of r.findings) {
    if (f.state === "sourced" || f.state === "none_mapped") {
      if (!f.sources.length) bad("report", `${f.id}: cites a source`, "≥1 source", "none");
      if (f.basis === "official" && f.sources.some((s) => !s.url)) bad("report", `${f.id}: source has a URL`, "url", "none");
      if (f.looked_up_at && f.looked_up_at !== run.fx.captured_at) bad("report", `${f.id}: retrieved-at`, run.fx.captured_at, f.looked_up_at);
      if (f.id !== "permitted_uses" && f.basis === "official" && !f.looked_up_at) bad("report", `${f.id}: retrieved-at`, run.fx.captured_at, "none");
    }
    for (const s of f.sources) if (!r.sources.some((x) => x.name === s.name)) bad("report", `${f.id}: source listed in Sources`, s.name, "missing");
  }
  if (r.property.catastro.value && r.property.catastro.source?.dataset_date !== "2025-02") bad("report", "CRIM edition on the catastro source", "2025-02", r.property.catastro.source?.dataset_date ?? "none");
  for (const s of r.sources) {
    for (const [name, t] of [["summary", out.summary.en], ["pdf", out.pdf.en]] as const) if (!contains(t, s.name, name === "pdf")) bad(name, "source cited", s.name, "missing");
    if (s.dataset_date && !contains(out.pdf.en, s.dataset_date, true)) bad("pdf", `source date (${s.name})`, s.dataset_date, "missing");
  }
  if (!out.summary.en.includes(run.fx.captured_at)) bad("summary", "retrieved-at shown", run.fx.captured_at, "missing");
  if (!contains(out.pdf.en, run.fx.captured_at.slice(0, 10), true)) bad("pdf", "retrieved-at shown", run.fx.captured_at.slice(0, 10), "missing");

  // ---- Output parity: every finding's title + value/state in every output ---------------------
  const shown = (f: ReportFinding, lang: "en" | "es") => (f.value && (f.state === "sourced" || f.state === "none_mapped" || f.state === "not_evaluated") ? f.value[lang] : null);
  for (const f of r.findings) {
    for (const [name, t, lang] of texts) {
      const isPdf = name.startsWith("pdf");
      if (!contains(t, f.title[lang], isPdf)) bad(name, `${f.id}: finding title`, f.title[lang], "missing");
      const v = shown(f, lang);
      // The PDF and drawer may show the plain-language line with the value beneath it.
      if (v && !contains(t, v, isPdf)) bad(name, `${f.id}: finding value`, v, "missing");
    }
  }
  const exported = JSON.parse(out.json) as PropertyReport;
  if (JSON.stringify({ ...exported, professional_review: undefined }) !== JSON.stringify({ ...r, professional_review: undefined })) bad("json", "full report export = report", "identical", "differs");
  if (!out.passport || JSON.stringify(out.passport) !== JSON.stringify(r)) bad("passport", "saved copy = report", "identical", "differs");
  // Preview chips: each chip's text comes from its finding.
  for (const f of r.findings) if (f.pill && out.preview.en.includes(f.title.en) === false && out.preview.en.includes(f.pill.en) === false && (f.key || f.tone === "hazard" || f.tone === "attention") && (f.state === "sourced" || f.state === "none_mapped")) bad("preview", `${f.id}: chip shown`, f.pill.en, "missing");
  return issues;
}
