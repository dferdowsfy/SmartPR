// ============================================================================
// Reviewer assessment — the Property & Site Report read the way a permit
// reviewer would: a short conclusion, findings sorted into
//   REVIEW REQUIRED · CLEAR · UNABLE TO VERIFY,
// ranked next steps, and only the information still needed from the user.
//
// Pure presentation over an already-built PropertyReport: it adds no data,
// changes no finding and never upgrades certainty. "Unable to verify" is
// never shown as clear, and "clear" means only "checked, nothing mapped".
// Works on saved v1 reports too (everything is derived from findings).
// ============================================================================

import type { Bi, PropertyReport, ReportFinding, ReportScope, ReportSource } from "./propertyReport.ts";
import { COMPATIBILITY_TEXT, REQUIREMENT_TEXT } from "./landUse.ts";

export type AssessmentStatus = "review" | "mapped" | "clear" | "unable";
export interface AssessmentItem {
  id: string;
  label: Bi;
  value: Bi;
  /** Genuinely severe / restrictive (protection designations): shown in red, otherwise amber. */
  severe?: boolean;
  /** Short clause for the conclusion sentence. */
  phrase?: Bi;
  finding_ids: string[];
  /** Evaluation scope and dataset the item rests on (shown with "no mapped intersection" items). */
  scope?: ReportScope;
  dataset?: { name: string; url: string | null; date: string | null } | null;
}
export interface AssessmentAction {
  id: string;
  issue: Bi;
  action: Bi;
  /** Why this step appears (shown behind "Why?"). */
  why: Bi | null;
  sources: ReportSource[];
}
export interface ReviewerAssessment {
  conclusion: Bi;
  review: AssessmentItem[];
  /** Mapped results that are findings (a classification, FEMA Zone X, a susceptibility class) with no constraint indicated by that layer alone. Never "no mapped intersection". */
  mapped: AssessmentItem[];
  clear: AssessmentItem[];
  unable: AssessmentItem[];
  /** Ranked, most important first. */
  actions: AssessmentAction[];
  /** Only information SmartPR needs from the user (never unavailable government data). */
  still_needed: Array<{ id: string; title: Bi; text: Bi }>;
}

const bi = (en: string, es: string = en): Bi => ({ en, es });
const answered = (f?: ReportFinding) => !!f && (f.state === "sourced" || f.state === "none_mapped");
const unableValue = (f: ReportFinding | undefined): Bi =>
  !f || f.state === "unavailable" ? bi("Source did not respond", "La fuente no respondió")
  : f.state === "not_performed" ? bi("Not checked", "No verificado")
  : f.state === "stale" ? bi("Refreshing for this location", "Actualizando para esta ubicación")
  : f.state === "loading" ? bi("Checking…", "Verificando…")
  : bi("Insufficient evidence", "Evidencia insuficiente");
const shortTitle = (f: ReportFinding): Bi => bi(f.title.en.replace(/ \(.*\)$/, ""), f.title.es.replace(/ \(.*\)$/, ""));
const joinList = (xs: string[], and: string) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);
const pct = (s: number) => (s >= 0.9995 ? ">99.9%" : s < 0.001 ? "<0.1%" : `${(Math.round(s * 1000) / 10).toFixed(1)}%`);

export function reviewerAssessment(r: PropertyReport): ReviewerAssessment {
  const F = (id: string) => r.findings.find((f) => f.id === id);
  const step = (id: string) => r.next_steps.steps.find((s) => s.id === id);
  const review: AssessmentItem[] = [], mapped: AssessmentItem[] = [], clear: AssessmentItem[] = [], unable: AssessmentItem[] = [];
  const actions: Array<AssessmentAction & { rank: number }> = [];
  const act = (rank: number, a: AssessmentAction) => actions.push({ ...a, rank });
  const lu = r.land_use?.activity.use ? r.land_use : null;
  const NONE = bi("No mapped intersection identified", "No se identificó intersección mapeada");

  // ---- Location validation (first: everything else depends on the right place) ----
  const loc = r.property.location;
  const roadway = !!loc?.roadway;
  const noParcel = !!loc && loc.parcel !== "verified" && loc.parcel !== "loading";
  if (noParcel) {
    review.push({ id: "location", label: bi("Location", "Ubicación"),
      value: roadway ? bi("Selected point mapped as a roadway (VIAL); no cadastral parcel identified — findings are point-only", "Punto seleccionado mapeado como vía (VIAL); no se identificó parcela catastral — hallazgos solo del punto")
        : loc!.parcel === "unavailable" ? bi("Parcel source did not respond — findings are point-only", "La fuente de parcelas no respondió — hallazgos solo del punto")
        : bi("No cadastral parcel identified — findings are point-only", "No se identificó parcela catastral — hallazgos solo del punto"),
      phrase: roadway ? bi("the selected point appears to be on a roadway (VIAL), with no cadastral parcel identified", "el punto seleccionado parece estar sobre una vía (VIAL), sin parcela catastral identificada")
        : bi("no cadastral parcel was identified, so parcel-wide checks have not been performed", "no se identificó parcela catastral, así que no se realizaron verificaciones de toda la parcela"),
      finding_ids: [], scope: "point" });
    act(1, { id: "location", issue: bi("Confirm the exact property", "Confirme la propiedad exacta"),
      action: loc!.point_confirmed
        ? bi("You confirmed this point. No cadastral parcel boundary was identified, so parcel-wide checks remain not performed; obtain the parcel record (CRIM catastro) if parcel-wide results are needed.", "Usted confirmó este punto. No se identificó un límite de parcela catastral, así que las verificaciones de toda la parcela siguen sin realizarse; obtenga el registro de la parcela (catastro del CRIM) si necesita resultados de toda la parcela.")
        : roadway
          ? bi("This point may be on a roadway rather than your intended property. Move or confirm the pin before evaluating site-specific requirements (Adjust pin / Confirm this point).", "Este punto puede estar sobre una vía y no en su propiedad. Mueva o confirme el pin antes de evaluar requisitos específicos del lugar (Ajustar pin / Confirmar este punto).")
          : bi("Move the pin onto the property or confirm this point. Parcel-wide checks have not been performed.", "Mueva el pin a la propiedad o confirme este punto. No se han realizado verificaciones de toda la parcela."),
      why: loc!.notices[0] ?? null, sources: r.property.catastro.source ? [r.property.catastro.source] : [] });
  }

  // ---- Flood ----------------------------------------------------------------
  const fz = F("flood_zone"), fw = F("floodway"), adv = F("flood_advisory");
  if (fw?.state === "sourced") {
    review.push({ id: "floodway", label: bi("Flood", "Inundación"), value: bi("Regulatory floodway mapped", "Cauce mayor reglamentario mapeado"), severe: true, phrase: bi("a regulatory floodway is mapped on the parcel", "hay un cauce mayor reglamentario mapeado en la parcela"), finding_ids: ["floodway"] });
    const s = step("protection_floodway");
    act(10, { id: "floodway", issue: bi("Regulatory floodway", "Cauce mayor reglamentario"),
      action: bi("Plan development outside the mapped floodway where possible. If encroachment is proposed, confirm whether engineering analysis and no-rise documentation are required.", "Planifique el desarrollo fuera del cauce mayor mapeado cuando sea posible. Si se propone una intrusión, confirme si se requieren un análisis de ingeniería y documentación de no aumento (no-rise)."),
      why: s ? bi(`${s.text.en} ${s.because.en}`, `${s.text.es} ${s.because.es}`) : null, sources: s?.sources ?? fw.sources });
  } else if (fw?.state === "none_mapped") {
    clear.push({ id: "floodway", label: bi("Regulatory floodway", "Cauce mayor"), value: NONE, finding_ids: ["floodway"] });
  }
  if (fz?.state === "sourced" && fz.tone === "hazard") {
    const parts = (fz.coverage?.parts ?? []).filter((p) => /^(A|V)/.test(p.key));
    const share = parts.reduce((s, p) => s + p.share, 0);
    const zones = [...new Set(parts.map((p) => p.key.split("|")[0]))].join(", ");
    review.push({ id: "flood_sfha", label: bi("Flood", "Inundación"),
      value: parts.length ? bi(`FEMA Special Flood Hazard Area (Zone ${zones}) mapped on approximately ${pct(share)} of the parcel`, `Área Especial de Riesgo a Inundación de FEMA (Zona ${zones}) mapeada en aproximadamente ${pct(share)} de la parcela`) : bi("FEMA Special Flood Hazard Area mapped", "Área Especial de Riesgo a Inundación de FEMA mapeada"),
      phrase: parts.length ? bi(`approximately ${pct(share)} of the parcel is in a mapped FEMA Special Flood Hazard Area`, `aproximadamente ${pct(share)} de la parcela está en un Área Especial de Riesgo a Inundación de FEMA mapeada`) : bi("a FEMA Special Flood Hazard Area is mapped", "hay un Área Especial de Riesgo a Inundación de FEMA mapeada"),
      finding_ids: ["flood_zone"] });
    const s = step("flood_mapped");
    act(30, { id: "flood_sfha", issue: bi("Special Flood Hazard Area", "Área Especial de Riesgo a Inundación"),
      action: bi("Keep proposed work outside the mapped flood hazard area where possible. If work falls inside it, confirm with the reviewing agency whether floodplain review applies.", "Mantenga la obra propuesta fuera del área de riesgo mapeada cuando sea posible. Si la obra cae dentro, confirme con la agencia evaluadora si aplica la revisión de zona inundable."),
      why: s ? s.text : fz.plain ?? null, sources: s?.sources ?? fz.sources });
  }
  // 0.2% annual-chance (shaded Zone X): mapped exposure on the effective FIRM, outside the SFHA.
  const shadedParts = fz?.state === "sourced" ? (fz.coverage?.parts ?? []).filter((p) => /^X\|.*0\.2/i.test(p.key)) : [];
  if (shadedParts.length) {
    const share = shadedParts.reduce((t, p) => t + p.share, 0);
    review.push({ id: "flood_shaded_x", label: bi("Flood exposure", "Exposición a inundación"),
      value: bi(`0.2% annual-chance flood hazard (shaded Zone X) on approximately ${pct(share)} of the parcel — effective FEMA map; outside the Special Flood Hazard Area`, `Peligro de inundación de 0.2% anual (Zona X sombreada) en aproximadamente ${pct(share)} de la parcela — mapa vigente de FEMA; fuera del Área Especial de Riesgo`),
      phrase: bi(`approximately ${pct(share)} of the parcel is in the 0.2% annual-chance flood area (shaded Zone X)`, `aproximadamente ${pct(share)} de la parcela está en el área de inundación de 0.2% anual (Zona X sombreada)`),
      finding_ids: ["flood_zone"], scope: fz!.scope });
    act(50, { id: "flood_shaded_x", issue: bi("0.2% annual-chance flood area", "Área de inundación de 0.2% anual"),
      action: bi("Locate the proposed building, pool and access relative to the shaded Zone X area on a site plan; parcel-wide percentages cannot show whether the footprint is in it.", "Ubique el edificio, la piscina y el acceso propuestos respecto al área de Zona X sombreada en un plano de sitio; los porcentajes de la parcela no muestran si la huella cae en ella."),
      why: bi("Shaded Zone X is mapped flood exposure on the effective FIRM, even though it is outside the Special Flood Hazard Area and no floodway is mapped.", "La Zona X sombreada es exposición a inundación mapeada en el FIRM vigente, aunque esté fuera del Área Especial de Riesgo y no haya cauce mayor mapeado."), sources: fz!.sources });
  }
  if (fz?.state === "sourced" && fz.tone !== "hazard" && !shadedParts.length) {
    const first = (s: string) => s.split(/\. /)[0]!.replace(/\.$/, "");
    mapped.push({ id: "flood_zone", label: bi("FEMA flood zone", "Zona inundable FEMA"), value: fz.plain ? bi(first(fz.plain.en), first(fz.plain.es)) : fz.value ?? bi("No high-risk zone mapped", "Sin zona de alto riesgo mapeada"), finding_ids: ["flood_zone"] });
  } else if (fz && fz.state !== "sourced") {
    unable.push({ id: "flood_zone", label: bi("FEMA flood zone", "Zona inundable FEMA"), value: unableValue(fz), finding_ids: ["flood_zone"] });
  }
  if (adv?.state === "sourced") {
    review.push({ id: "flood_advisory", label: bi("JP advisory flood map", "Mapa de inundación de asesoramiento (JP)"), value: bi("Advisory flood area mapped at the pin (not the effective FEMA map)", "Área inundable de asesoramiento mapeada en el pin (no es el mapa vigente de FEMA)"), phrase: bi("the JP advisory flood map shows a flood area at the pin", "el mapa de asesoramiento de la JP muestra un área inundable en el pin"), finding_ids: ["flood_advisory"] });
    act(55, { id: "flood_advisory", issue: bi("Advisory flood map", "Mapa de inundación de asesoramiento"), action: bi("Ask the reviewing agency whether it will apply the JP advisory flood map or the effective FEMA map to this site.", "Pregunte a la agencia evaluadora si aplicará el mapa de asesoramiento de la JP o el mapa vigente de FEMA a este lugar."), why: adv.plain ?? null, sources: adv.sources });
  } else if (adv?.state === "none_mapped") {
    clear.push({ id: "flood_advisory", label: bi("JP advisory flood map", "Mapa de asesoramiento (JP)"), value: NONE, finding_ids: ["flood_advisory"] });
  } else if (adv) {
    unable.push({ id: "flood_advisory", label: bi("JP advisory flood map", "Mapa de asesoramiento (JP)"), value: unableValue(adv), finding_ids: ["flood_advisory"] });
  }

  // ---- Zoning & land use -----------------------------------------------------------
  const zf = F("zoning");
  const zoningParts = zf?.coverage?.parts ?? [];
  const zoningCodes = zoningParts.length ? zoningParts.filter((p) => !p.small).map((p) => p.key) : zf?.value ? [zf.value.en.split(" ")[0]!] : [];
  const cons = zf?.meta?.conservation ?? [];
  if (zf?.state === "sourced" && cons.length) {
    const share = zoningParts.filter((p) => cons.includes(p.key)).reduce((s, p) => s + p.share, 0);
    const where = share ? bi(`affects approximately ${pct(share)} of the parcel`, `afecta aproximadamente ${pct(share)} de la parcela`) : bi("is mapped on the parcel", "está mapeada en la parcela");
    review.push({ id: "zoning_conservation", label: bi("Zoning", "Calificación"), value: bi(`${cons.join(", ")} conservation zoning ${where.en}`, `Calificación de conservación ${cons.join(", ")} ${where.es}`),
      phrase: share ? bi(`approximately ${pct(share)} of the parcel is within ${cons.join(", ")} conservation zoning`, `aproximadamente ${pct(share)} de la parcela está en calificación de conservación ${cons.join(", ")}`) : bi(`${cons.join(", ")} conservation zoning is mapped`, `hay calificación de conservación ${cons.join(", ")} mapeada`),
      finding_ids: ["zoning"] });
    const s = step("protection_zoning");
    act(20, { id: "zoning_conservation", issue: bi("Conservation zoning", "Calificación de conservación"),
      action: bi(`Confirm allowable uses within the ${cons.join(", ")} portion of the parcel before designing work in that area.`, `Confirme los usos permitidos en la porción ${cons.join(", ")} de la parcela antes de diseñar obras en esa área.`),
      why: s?.because ?? null, sources: s?.sources ?? zf.sources });
  } else if (zf && !answered(zf)) {
    unable.push({ id: "zoning", label: bi("Zoning", "Calificación"), value: unableValue(zf), finding_ids: ["zoning"] });
  }
  // Road (VIAL) and small zoning intersections: explained, neither fatal nor dismissed.
  const minor = zf?.state === "sourced" ? zoningParts.filter((p) => p.small || /^vial$/i.test(p.key)) : [];
  if (minor.length && zoningParts.length > 1) {
    review.push({ id: "zoning_minor", label: bi("Zoning — minor or road intersections", "Calificación — intersecciones menores o viales"),
      value: bi(`${minor.map((p) => `${p.key} ${p.share_text}${/^vial$/i.test(p.key) ? " (road district)" : " (small intersection)"}`).join(" · ")} — may be a right-of-way, a real strip or a map-edge difference`, `${minor.map((p) => `${p.key} ${p.share_text}${/^vial$/i.test(p.key) ? " (distrito vial)" : " (intersección pequeña)"}`).join(" · ")} — puede ser una servidumbre, una franja real o una diferencia de bordes`),
      phrase: bi(`small parts of the parcel are mapped ${minor.map((p) => p.key).join(" and ")}`, `pequeñas partes de la parcela están mapeadas ${minor.map((p) => p.key).join(" y ")}`), finding_ids: ["zoning"], scope: zf!.scope });
    act(58, { id: "zoning_minor", issue: bi("Minor and road zoning intersections", "Intersecciones menores y viales"),
      action: bi("Check on a site plan over a boundary survey whether the building, yards, access or other site work fall in these strips before relying on the main district.", "Verifique en un plano de sitio sobre una mensura si el edificio, los patios, el acceso u otras obras caen en estas franjas antes de depender del distrito principal."),
      why: bi("Parcel-wide percentages cannot establish where the proposed footprint sits.", "Los porcentajes de la parcela no pueden establecer dónde queda la huella propuesta."), sources: zf!.sources });
  }
  const ov = F("zoning_overlay");
  if (ov?.state === "sourced") {
    const dov = r.land_use?.decision?.governing.overlays ?? [];
    const unknown = dov.filter((o) => o.provisions !== "encoded");
    review.push({ id: "zoning_overlay", label: bi("Overlay district", "Distrito sobrepuesto"),
      value: bi(`${ov.value?.en ?? ""} — overlay provisions apply on top of the base district${unknown.length ? "; provisions not obtained" : ""}`, `${ov.value?.es ?? ""} — las disposiciones sobrepuestas aplican encima del distrito base${unknown.length ? "; disposiciones no obtenidas" : ""}`),
      phrase: bi(`an overlay district (${ov.value?.en ?? ""}) is mapped whose provisions prevail over the base zoning`, `hay un distrito sobrepuesto (${ov.value?.es ?? ""}) cuyas disposiciones prevalecen sobre la calificación base`), finding_ids: ["zoning_overlay"], scope: ov.scope });
    act(22, { id: "zoning_overlay", issue: bi("Overlay district provisions", "Disposiciones del distrito sobrepuesto"),
      action: unknown.length && unknown[0]!.obtainFrom ? bi(`Obtain the overlay's adopted provisions from ${unknown[0]!.obtainFrom}.`, `Obtenga las disposiciones adoptadas de la zona sobrepuesta de ${unknown[0]!.obtainFrom}.`) : bi("Obtain the overlay plan's provisions and confirm how they change the base district for this parcel.", "Obtenga las disposiciones del plan sobrepuesto y confirme cómo cambian el distrito base para esta parcela."),
      why: bi("RC 2023 Sección 6.1.1.3(m) (p. 314): overlay zones of special or territorial plans prevail over the equivalent zoning district.", "RC 2023 Sección 6.1.1.3(m) (p. 314): las zonas sobrepuestas de planes especiales o territoriales prevalecen sobre el distrito equivalente."), sources: ov.sources });
  }
  const districts = zoningParts.length ? zoningParts.filter((p) => !p.small).map((p) => `${p.key} ${p.share_text}`).join(" · ") : zf?.value?.en ?? "";
  if (roadway) {
    review.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"),
      value: bi("Not evaluated — the selected point is mapped as a roadway (VIAL), not a developable district; confirm the property first", "No evaluado — el punto seleccionado está mapeado como vía (VIAL), no como distrito desarrollable; confirme primero la propiedad"),
      phrase: bi("land-use compatibility was not evaluated on the roadway point", "la compatibilidad de uso no se evaluó en el punto de vía"),
      finding_ids: ["permitted_uses"] });
  } else if (!lu && zf && !answered(zf)) {
    // Zoning itself is unresolved: compatibility is not evaluated, whatever the activity.
    review.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"),
      value: bi("Not evaluated — zoning is unresolved and no proposed activity was given", "No evaluado — la calificación no está resuelta y no se indicó la actividad propuesta"),
      phrase: bi("land-use compatibility is not evaluated because zoning is unresolved and no activity was described", "la compatibilidad de uso no se evalúa porque la calificación no está resuelta y no se describió la actividad"), finding_ids: ["permitted_uses", "zoning"] });
    act(40, { id: "compatibility", issue: bi("Land-use compatibility", "Compatibilidad de uso"),
      action: bi("First obtain the zoning (calificación) record — the source did not answer — and describe the proposed activity. Compatibility is evaluated only when both are known and the governing rules are identified.", "Obtenga primero el registro de calificación — la fuente no respondió — y describa la actividad propuesta. La compatibilidad se evalúa solo cuando ambos se conocen y se identifican las reglas aplicables."),
      why: bi("Permitted uses depend on the zoning district and on what you plan to do.", "Los usos permitidos dependen del distrito y de lo que planifica hacer."), sources: F("permitted_uses")?.sources ?? [] });
  } else if (!lu) {
    review.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"),
      value: bi(`Proposed activity required before compatibility can be evaluated${districts ? ` (zoning: ${districts})` : ""}`, `Se requiere la actividad propuesta para evaluar la compatibilidad${districts ? ` (calificación: ${districts})` : ""}`),
      phrase: bi("land-use compatibility cannot be determined until the proposed activity is provided", "la compatibilidad de uso no puede determinarse hasta que se indique la actividad propuesta"), finding_ids: ["permitted_uses", "zoning"] });
    act(40, { id: "compatibility", issue: bi("Land-use compatibility", "Compatibilidad de uso"),
      action: bi(`Describe the proposed activity so SmartPR can evaluate compatibility with the ${joinList(zoningCodes, "and") || "mapped"} zoning district${zoningCodes.length > 1 ? "s" : ""}.`, `Describa la actividad propuesta para que SmartPR evalúe la compatibilidad con ${zoningCodes.length > 1 ? "los distritos" : "el distrito"} ${joinList(zoningCodes, "y") || "mapeado"}.`),
      why: bi("Permitted uses depend on the zoning district and on what you plan to do.", "Los usos permitidos dependen del distrito y de lo que planifica hacer."), sources: F("permitted_uses")?.sources ?? [] });
  } else if (lu.decision) {
    // One reasoning result: the decision (landUse.ts) — undetermined unless rules, overlays and facts support it.
    const d = lu.decision;
    const und = d.compatibility.status === "undetermined";
    review.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"),
      value: bi(`${d.compatibility.label.en}${und && d.compatibility.ruleReading ? ` (rule reading, not a conclusion: ${d.compatibility.ruleReading.en})` : ""}`, `${d.compatibility.label.es}${und && d.compatibility.ruleReading ? ` (lectura de la regla, no es conclusión: ${d.compatibility.ruleReading.es})` : ""}`),
      phrase: und ? bi(`compatibility for ${d.use.en} is undetermined until the evidence gaps are closed`, `la compatibilidad para ${d.use.es} está indeterminada hasta cerrar las brechas de evidencia`) : bi(`the rule reading for ${d.use.en} is: ${d.compatibility.label.en.toLowerCase()}`, `la lectura de la regla para ${d.use.es} es: ${d.compatibility.label.es.toLowerCase()}`),
      severe: false, finding_ids: ["permitted_uses"] });
    act(25, { id: "compatibility", issue: bi("Land-use compatibility", "Compatibilidad de uso"), action: d.pathway.nextAction, why: d.compatibility.reason, sources: F("permitted_uses")?.sources ?? [] });
    for (const [i, a] of lu.approvals.entries()) {
      const rq = a.requirement ?? (a.status === "confirmed" ? "required" : a.status === "likely" ? "potentially_required" : "unresolved");
      act(32 + i / 100, { id: `approval_${a.id}`, issue: bi(a.name), action: bi(`${REQUIREMENT_TEXT[rq].en}: ${a.needs ? `depends on ${a.needs.en}` : a.trigger} Authority: ${a.agency || "—"}.`, `${REQUIREMENT_TEXT[rq].es}: ${a.needs ? `depende de ${a.needs.es}` : a.trigger} Autoridad: ${a.agency || "—"}.`), why: a.citation ? bi(a.citation) : null, sources: a.sources.map((x) => ({ name: x.name, url: x.url, dataset_date: null, version: x.citation || null })) });
    }
  } else {
    // The governing regulation is not verified: the rule reading is preliminary
    // and the analysis stays pending — never "clear", never "permitted".
    const o = lu.compatibility.outcome;
    const reg = r.regulation;
    const pending = !reg || reg.applicability !== "verified";
    const val = bi(`${lu.activity.useName}: ${COMPATIBILITY_TEXT[o].en}`, `${lu.activity.useName}: ${COMPATIBILITY_TEXT[o].es}`);
    const reasons = bi(lu.compatibility.reasons.join(" "));
    const pointOnly = F("permitted_uses")?.scope === "point";
    review.push({ id: "compatibility", label: bi("Land-use compatibility", "Compatibilidad de uso"),
      value: pending ? bi(`Pending — governing regulation not verified (preliminary reading under ${reg?.name ?? "the listed regulation"}: ${val.en}${pointOnly ? "; selected point only" : ""})`, `Pendiente — reglamento aplicable no verificado (lectura preliminar según ${reg?.name ?? "el reglamento listado"}: ${val.es}${pointOnly ? "; solo el punto seleccionado" : ""})`) : bi(`${val.en} — requires review`, `${val.es} — requiere revisión`),
      phrase: pending ? bi(`permitted-use analysis for ${lu.activity.useName} is pending because the governing regulation has not been verified`, `el análisis de usos para ${lu.activity.useName} está pendiente porque no se ha verificado el reglamento aplicable`) : bi(`land-use compatibility for ${lu.activity.useName} requires review`, `la compatibilidad de uso para ${lu.activity.useName} requiere revisión`),
      severe: false, finding_ids: ["permitted_uses"] });
    const how = o === "conditional" ? bi("The preliminary reading lists conditions for this use; review them before design.", "La lectura preliminar lista condiciones para este uso; revíselas antes del diseño.")
      : o === "discretionary" ? bi("The preliminary reading points to a discretionary process (consulta de ubicación or exception); approval is not assured.", "La lectura preliminar apunta a un proceso discrecional (consulta de ubicación o excepción); la aprobación no está asegurada.")
      : o === "potentially_prohibited" ? bi("The preliminary reading does not list this use for the mapped district; confirm with the Junta de Planificación.", "La lectura preliminar no lista este uso para el distrito mapeado; confírmelo con la Junta de Planificación.")
      : o === "permitted" ? bi("The preliminary reading lists this use for the mapped district; conditions may still apply.", "La lectura preliminar lista este uso para el distrito mapeado; pueden aplicar condiciones.")
      : bi("The preliminary reading is incomplete; have a land-use professional review it.", "La lectura preliminar está incompleta; haga que un profesional la revise.");
    act(25, { id: "compatibility", issue: bi("Land-use compatibility", "Compatibilidad de uso"),
      action: pending ? bi(`Confirm which regulation governs this site (Reglamento Conjunto 2023, a municipal Plan Territorial regulation, or later amendments) before relying on the result. ${how.en}`, `Confirme qué reglamento rige este lugar (Reglamento Conjunto 2023, un reglamento de Plan Territorial municipal o enmiendas posteriores) antes de depender del resultado. ${how.es}`) : how,
      why: reg ? bi(`${reasons.en} ${reg.note.en}`.trim(), `${reasons.es} ${reg.note.es}`.trim()) : reasons, sources: F("permitted_uses")?.sources ?? [] });
    for (const [i, a] of lu.approvals.entries()) {
      act(32 + i / 100, { id: `approval_${a.id}`, issue: bi(a.name), action: bi(`${a.status === "confirmed" ? "Required by a verified rule" : a.status === "likely" ? "Likely required" : "Needs professional review"}: ${a.trigger}${a.evidence.length ? ` Typical evidence: ${a.evidence.join("; ")}.` : ""}`), why: a.citation ? bi(a.citation) : null, sources: a.sources.map((s) => ({ name: s.name, url: s.url, dataset_date: null, version: s.citation || null })) });
    }
  }
  const lc = F("land_class");
  if (lc?.state === "sourced" && lc.constraint === "protection") {
    review.push({ id: "land_class", label: bi("Land classification", "Clasificación del suelo"), value: bi("Specially protected rustic land (SREP) at the pin", "Suelo rústico especialmente protegido (SREP) en el pin"), severe: true, phrase: bi("the pin is on specially protected rustic land", "el pin está en suelo rústico especialmente protegido"), finding_ids: ["land_class"] });
    const s = step("protection_land_class");
    act(12, { id: "land_class", issue: bi("Specially protected rustic land", "Suelo rústico especialmente protegido"), action: bi("Confirm with the Junta de Planificación what, if anything, the classification allows before planning work.", "Confirme con la Junta de Planificación qué permite la clasificación, si algo, antes de planificar obras."), why: s?.because ?? null, sources: s?.sources ?? lc.sources });
  } else if (lc?.state === "sourced" && roadway && /\bvial\b/i.test(lc.value?.en ?? "")) {
    // A roadway classification corroborates the location issue; it is not a cleared check.
    const li = review.find((x) => x.id === "location");
    if (li) li.value = bi(`${li.value.en}; land classification at the pin is also VIAL`, `${li.value.es}; la clasificación del suelo en el pin también es VIAL`);
  } else if (lc?.state === "sourced") {
    mapped.push({ id: "land_class", label: bi("Land classification", "Clasificación del suelo"), value: bi(`${lc.value?.en ?? ""} (no protection classification at the pin)`, `${lc.value?.es ?? ""} (sin clasificación de protección en el pin)`), finding_ids: ["land_class"] });
  } else if (lc) unable.push({ id: "land_class", label: bi("Land classification", "Clasificación del suelo"), value: unableValue(lc), finding_ids: ["land_class"] });
  const put = F("put");
  if (put?.state === "sourced" && roadway && /\bvial\b/i.test(put.value?.en ?? "")) {
    const li = review.find((x) => x.id === "location");
    if (li) li.value = bi(`${li.value.en}; PUT classification at the pin is VIAL`, `${li.value.es}; la clasificación del PUT en el pin es VIAL`);
  } else if (put?.state === "sourced") mapped.push({ id: "put", label: bi("PUT classification", "Clasificación del PUT"), value: put.value!, finding_ids: ["put"] });
  else if (put && put.state !== "none_mapped") unable.push({ id: "put", label: bi("PUT classification", "Clasificación del PUT"), value: unableValue(put), finding_ids: ["put"] });

  // ---- Environment & terrain ----------------------------------------------------------
  const env = (id: string, label: Bi, mapped: Bi, phrase: Bi, rank: number, action: Bi, opts: { severe?: boolean; clearValue?: Bi } = {}) => {
    const f = F(id);
    if (!f) return;
    if (f.state === "sourced") {
      review.push({ id, label, value: mapped, phrase, severe: opts.severe, finding_ids: [id] });
      const s = r.next_steps.steps.find((x) => x.sources.some((src) => f.sources.some((fs) => fs.name === src.name)));
      act(rank, { id, issue: label, action, why: s ? s.because : f.plain ?? null, sources: f.sources });
    } else if (f.state === "none_mapped") clear.push({ id, label, value: opts.clearValue ?? NONE, finding_ids: [id] });
    else unable.push({ id, label, value: unableValue(f), finding_ids: [id] });
  };
  env("protected_area", bi("Protected natural area", "Área natural protegida"), bi("Protected natural area mapped", "Área natural protegida mapeada"), bi("a protected natural area is mapped", "hay un área natural protegida mapeada"), 11,
    bi("Obtain the managing agency's (DRNA) written position before planning any land disturbance in the protected area.", "Obtenga la posición escrita de la agencia administradora (DRNA) antes de planificar movimientos de terreno en el área protegida."), { severe: true });
  env("natural_reserve", bi("Natural reserve", "Reserva natural"), bi("Natural reserve mapped", "Reserva natural mapeada"), bi("a natural reserve is mapped", "hay una reserva natural mapeada"), 11,
    bi("Confirm with DRNA and the Junta de Planificación what the reserve designation allows before planning work.", "Confirme con el DRNA y la Junta de Planificación qué permite la designación de reserva antes de planificar obras."), { severe: true });
  env("wetlands", bi("Wetlands & waters", "Humedales y cuerpos de agua"), bi("Mapped wetlands or waters on the parcel", "Humedales o cuerpos de agua mapeados en la parcela"), bi("wetlands or waters are mapped on the parcel", "hay humedales o cuerpos de agua mapeados en la parcela"), 45,
    bi("Have the wetland/waters area delineated before design; confirm whether fill or work there needs federal or state review.", "Haga delimitar el área de humedales o aguas antes del diseño; confirme si el relleno u obras allí requieren revisión federal o estatal."));
  env("coastal_zone", bi("Coastal zone", "Zona costanera"), bi("Inside the mapped coastal zone", "Dentro de la zona costanera mapeada"), bi("the site is inside the mapped coastal zone", "el lugar está dentro de la zona costanera mapeada"), 50,
    bi("Confirm with the reviewing agency whether coastal-zone consistency review applies to the proposed work.", "Confirme con la agencia evaluadora si aplica la revisión de compatibilidad con la zona costanera a la obra propuesta."), { clearValue: bi("Outside mapped boundary", "Fuera del límite mapeado") });
  env("historic_zone", bi("Historic zone", "Zona histórica"), bi("Historic zone mapped", "Zona histórica mapeada"), bi("a historic zone is mapped", "hay una zona histórica mapeada"), 50,
    bi("Confirm with the historic-preservation authority whether review applies before exterior, structural or ground-disturbing work.", "Confirme con la autoridad de conservación histórica si aplica revisión antes de obras exteriores, estructurales o de movimiento de tierra."));
  env("historic_site", bi("Historic sites", "Sitios históricos"), bi("Historic site mapped", "Sitio histórico mapeado"), bi("a historic site is mapped", "hay un sitio histórico mapeado"), 50,
    bi("Confirm with the historic-preservation authority whether review applies before work affecting the site.", "Confirme con la autoridad de conservación histórica si aplica revisión antes de obras que afecten el sitio."));
  env("archaeology", bi("Archaeological sensitivity", "Sensibilidad arqueológica"), bi("Archaeologically sensitive area mapped", "Área de sensibilidad arqueológica mapeada"), bi("an archaeologically sensitive area is mapped", "hay un área de sensibilidad arqueológica mapeada"), 52,
    bi("Confirm whether an archaeological assessment is expected before earthwork.", "Confirme si se espera una evaluación arqueológica antes de mover tierra."));
  const tf = F("terrain");
  if (tf?.state === "sourced" && (tf.tone === "hazard" || tf.tone === "attention")) {
    review.push({ id: "terrain", label: bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"), value: bi(`${tf.value?.en ?? ""} at the pin`, `${tf.value?.es ?? ""} en el pin`), phrase: bi(`${(tf.value?.en ?? "").toLowerCase()} landslide susceptibility is mapped at the pin`, `hay susceptibilidad ${(tf.value?.es ?? "").toLowerCase()} a deslizamientos en el pin`), finding_ids: ["terrain"] });
    act(60, { id: "terrain", issue: bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"), action: bi("Consider slope stability in site design; confirm whether a geotechnical evaluation is expected for the proposed work.", "Considere la estabilidad de pendientes en el diseño; confirme si se espera una evaluación geotécnica para la obra propuesta."), why: tf.plain ?? null, sources: tf.sources });
  } else if (tf?.state === "sourced") mapped.push({ id: "terrain", label: bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"), value: tf.value!, finding_ids: ["terrain"] });
  else if (tf?.state === "none_mapped") clear.push({ id: "terrain", label: bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"), value: bi("None mapped", "Nada mapeado"), finding_ids: ["terrain"] });
  else if (tf) unable.push({ id: "terrain", label: bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"), value: unableValue(tf), finding_ids: ["terrain"] });
  const so = F("soils");
  if (so && !answered(so)) unable.push({ id: "soils", label: bi("Soils", "Suelos"), value: unableValue(so), finding_ids: ["soils"] });

  // ---- Discrepancies, unverified sources, small intersections ----------------------------
  for (const [i, d] of (r.discrepancies ?? []).entries()) {
    review.push({ id: `discrepancy_${i}`, label: bi("Source discrepancy", "Discrepancia entre fuentes"), value: d, phrase: bi("official sources disagree on one item", "las fuentes oficiales difieren en un punto"), finding_ids: [] });
    act(65 + i / 100, { id: `discrepancy_${i}`, issue: bi("Source discrepancy", "Discrepancia entre fuentes"), action: bi("Ask the responsible agency to confirm which answer applies before relying on it.", "Pida a la agencia responsable que confirme cuál respuesta aplica antes de depender de ella."), why: d, sources: [] });
  }
  if (unable.length) {
    act(70, { id: "unverified", issue: bi("Checks that could not be verified", "Verificaciones no confirmadas"),
      action: bi(`Re-run the lookup later or request the information from the agency for: ${unable.map((u) => u.label.en).join(", ")}. Until then these items are unknown, not clear.`, `Vuelva a consultar más tarde o solicite la información a la agencia para: ${unable.map((u) => u.label.es).join(", ")}. Hasta entonces son desconocidos, no despejados.`),
      why: null, sources: [] });
  }
  const small = r.findings.flatMap((f) => (f.coverage?.parts ?? []).filter((p) => p.small).map((p) => `${shortTitle(f).en}: ${p.key.split("|")[0]} (${p.share_text})`));
  if (small.length) act(80, { id: "small_intersections", issue: bi("Small mapped intersections", "Intersecciones mapeadas pequeñas"), action: bi(`If they matter for your plans, confirm with a licensed surveyor: ${small.join("; ")}.`, `Si importan para sus planes, confírmelas con un agrimensor licenciado: ${small.join("; ")}.`), why: bi("The maps alone cannot tell a real strip from an edge-alignment difference.", "Los mapas por sí solos no distinguen una franja real de una diferencia de bordes."), sources: [] });

  // ---- Still needed (user input only) -------------------------------------------------
  const still: ReviewerAssessment["still_needed"] = [];
  if (!lu && !roadway) still.push({ id: "activity", title: bi("Proposed activity", "Actividad propuesta"), text: bi("Describe what you plan to build, operate, renovate, or use the property for so SmartPR can evaluate land-use compatibility and permitted-use rules.", "Describa qué planifica construir, operar, remodelar o para qué usará la propiedad, para que SmartPR evalúe la compatibilidad de uso y las reglas de usos permitidos.") });
  if (noParcel && !loc!.point_confirmed) still.push({ id: "pin", title: bi("Exact property location", "Ubicación exacta de la propiedad"), text: roadway ? bi("This point may be on a roadway rather than your intended property. Adjust the pin onto the property or confirm this point.", "Este punto puede estar sobre una vía y no en su propiedad. Ajuste el pin a la propiedad o confirme este punto.") : bi("No cadastral parcel was identified at the pin. Adjust the pin onto the property or confirm this point.", "No se identificó parcela catastral en el pin. Ajuste el pin a la propiedad o confirme este punto.") });
  else if (r.property.coordinate_source === "GEOCODED_ADDRESS") still.push({ id: "pin", title: bi("Exact property location", "Ubicación exacta de la propiedad"), text: bi("The pin comes from an address search. Move it onto the exact property so the findings are for the right parcel.", "El pin viene de una búsqueda de dirección. Muévalo a la propiedad exacta para que los hallazgos sean de la parcela correcta.") });
  if (r.property.near_boundary) still.push({ id: "municipio", title: bi("Municipality", "Municipio"), text: bi("The pin is near a municipal boundary. Confirm the property is in the municipality shown.", "El pin está cerca de un límite municipal. Confirme que la propiedad está en el municipio indicado.") });

  // ---- Conclusion ---------------------------------------------------------------------
  const phrases = review.filter((x) => x.phrase).map((x) => x.phrase!);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const n = review.length;
  const lead = n
    ? bi(`Based on available official map sources, site review found ${n === 1 ? "one item" : `${n} items`} requiring attention: ${phrases.some((p) => /,| and /.test(p.en)) ? phrases.map((p) => p.en).join("; ") : joinList(phrases.map((p) => p.en), "and")}.`,
         `Según las fuentes cartográficas oficiales disponibles, la revisión encontró ${n === 1 ? "un punto" : `${n} puntos`} que requieren atención: ${phrases.some((p) => /,| y /.test(p.es)) ? phrases.map((p) => p.es).join("; ") : joinList(phrases.map((p) => p.es), "y")}.`)
    : bi("Based on available official map sources, no mapped constraint requiring review was identified among the checks that responded. This is not a clearance.", "Según las fuentes cartográficas oficiales disponibles, no se identificó una restricción mapeada que requiera revisión entre las verificaciones que respondieron. Esto no es una autorización.");
  const tail = unable.length ? bi(` ${unable.length === 1 ? "One check" : `${cap(String(unable.length))} checks`} could not be verified because the source did not respond or was not checked.`, ` ${unable.length === 1 ? "Una verificación" : `${unable.length} verificaciones`} no se ${unable.length === 1 ? "pudo" : "pudieron"} confirmar porque la fuente no respondió o no se consultó.`) : bi("");
  const pre = noParcel ? bi("Preliminary, point-only review. ", "Revisión preliminar, solo del punto. ") : bi("");
  // Items stay qualified by the scope and dataset they rest on.
  for (const x of [...review, ...mapped, ...clear, ...unable]) {
    const f = x.finding_ids[0] ? F(x.finding_ids[0]) : undefined;
    if (!f) continue;
    x.scope ??= f.scope;
    const s = f.sources[0];
    x.dataset ??= s ? { name: s.name, url: s.url, date: s.dataset_date } : null;
  }
  return {
    conclusion: bi(`${pre.en}${lead.en}${tail.en}`, `${pre.es}${lead.es}${tail.es}`),
    review: review.sort((a, b) => Number(!!b.severe) - Number(!!a.severe)),
    mapped, clear, unable,
    actions: actions.sort((a, b) => a.rank - b.rank).map((x) => ({ id: x.id, issue: x.issue, action: x.action, why: x.why, sources: x.sources })),
    still_needed: still,
  };
}
