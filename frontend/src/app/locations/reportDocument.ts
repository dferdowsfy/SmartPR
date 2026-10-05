// ============================================================================
// Report document — the full Property & Site Report as an ordered list of
// sections, built once from a PropertyReport snapshot. "Copy full report"
// and the PDF both render THIS structure, so they cannot disagree on
// identity, findings, status, scope, source, date or next steps.
// (Copy summary is the shorter reportSummaryText over the same snapshot.)
// ============================================================================

import { assessmentOf, BASIS_TEXT, basisOf, decisionText, findingStateText, reportArea, RETRIEVAL_TEXT, SCOPE_TEXT, snapshotLine, type Bi, type PropertyReport, type ReportFinding, type ReportTone } from "./propertyReport.ts";
import { COMPATIBILITY_TEXT, REQUIREMENT_TEXT } from "./landUse.ts";
import type { exportableReview } from "./propertyReview.ts";

type Lang = "en" | "es";

export interface DocSource { text: string; url: string | null }
/** One entry: a key finding (bullet) or a detailed finding (two-column row). */
export interface DocItem {
  title: string;
  value: string;
  tone: ReportTone;
  severe?: boolean;
  /** Status / basis / scope / pin — one short line. */
  meta?: string;
  /** Coverage, notes, ambiguities, method — every substantive line kept. */
  detail?: string[];
  source?: DocSource | null;
}
export interface DocGroup { label: string | null; tone: ReportTone | null; layout: "bullets" | "rows"; items: DocItem[] }
export interface DocSection { id: string; title: string; groups: DocGroup[]; paragraphs: string[] }
export interface ReportDocument {
  lang: Lang;
  title: string;
  address: string;
  generated: string;
  facts: Array<[string, string]>;
  areaNote: string;
  preliminary: string | null;
  notices: Array<{ text: string; warn: boolean }>;
  review: { label: string; tone: ReportTone } | null;
  conclusion: string;
  sections: DocSection[];
  snapshot: string;
  disclaimer: string;
  fileName: string;
}

const GROUPS: Array<[ReportFinding["group"], string, string]> = [["land", "Land & zoning", "Terreno y calificación"], ["flood", "Flood & water", "Inundación y agua"], ["environment", "Environment & terrain", "Ambiente y terreno"]];

export function reportDocument(report: PropertyReport, lang: Lang, review: ReturnType<typeof exportableReview> = null): ReportDocument {
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const t = (b: Bi | null | undefined) => (b ? b[lang] : "");
  const p = report.property;
  const area = reportArea(report);
  const A = assessmentOf(report);
  const sections: DocSection[] = [];
  const section = (id: string, title: string, groups: DocGroup[] = [], paragraphs: string[] = []) => { if (groups.some((g) => g.items.length) || paragraphs.length) sections.push({ id, title, groups: groups.filter((g) => g.items.length), paragraphs }); };

  // ---- Key regulatory findings (assessment groups) --------------------------------
  const keyGroups: Array<[keyof typeof A & ("review" | "mapped" | "clear" | "unable"), string, string, ReportTone]> = [
    ["review", "MATERIAL CONSTRAINTS OR EXPOSURE", "RESTRICCIONES O EXPOSICIÓN IMPORTANTES", "attention"],
    ["mapped", "MAPPED FINDINGS (NO CONSTRAINT INDICATED BY THE LAYER ALONE)", "HALLAZGOS MAPEADOS (LA CAPA POR SÍ SOLA NO INDICA RESTRICCIÓN)", "info"],
    ["clear", "NO MAPPED INTERSECTION IDENTIFIED (CHECKED; NOT A CLEARANCE)", "NO SE IDENTIFICÓ INTERSECCIÓN MAPEADA (VERIFICADO; NO ES AUTORIZACIÓN)", "ok"],
    ["unable", "UNRESOLVED OR INSUFFICIENT EVIDENCE", "SIN RESOLVER O EVIDENCIA INSUFICIENTE", "unknown"],
  ];
  section("key", L("Key regulatory findings", "Hallazgos regulatorios clave"), keyGroups.map(([k, en, es, tone]) => ({
    label: L(en, es), tone, layout: "bullets" as const,
    items: (A[k] ?? []).map((x) => ({
      title: t(x.label), value: t(x.value), tone, severe: x.severe,
      meta: [x.scope ? t(SCOPE_TEXT[x.scope]) : null, x.dataset ? `${x.dataset.name}${x.dataset.date ? ` (${x.dataset.date})` : ""}` : null].filter(Boolean).join(" · ") || undefined,
    })),
  })));

  // ---- Project decision (same lines as the copied summary) ------------------------
  const dec = decisionText(report, lang);
  section("decision", L("Project decision summary", "Resumen de decisión del proyecto"), [], dec.slice(2));

  // ---- Next steps / still needed ---------------------------------------------------
  section("next", L("Recommended next steps", "Próximos pasos recomendados"), [], A.actions.length
    ? A.actions.flatMap((x, i) => [`${i + 1}. ${t(x.issue)} — ${t(x.action)}`, ...(x.why ? [`   ${L("Why", "Por qué")}: ${t(x.why)}`] : []), ...(x.sources.length ? [`   ${L("Sources", "Fuentes")}: ${x.sources.map((s) => s.name).join("; ")}`] : [])])
    : [L("No actions identified from the available map sources.", "No se identificaron acciones con las fuentes disponibles.")]);
  section("needed", L("Still needed", "Aún falta"), [], A.still_needed.map((x) => `• ${t(x.title)}: ${t(x.text)}`));

  // ---- Detailed findings (every finding, every substantive line) ------------------------
  const row = (f: ReportFinding): DocItem => {
    const answered = f.state === "sourced" || f.state === "none_mapped";
    const shown = f.value && (answered || f.state === "not_evaluated") ? f.value[lang] : findingStateText(f.state)[lang];
    const main = answered && f.plain ? f.plain[lang] : shown;
    const meta = [
      answered && f.plain && f.value ? f.value[lang] : null,
      BASIS_TEXT[basisOf(f)][lang],
      answered ? t(SCOPE_TEXT[f.scope]) : f.scope === "not_evaluated" ? t(SCOPE_TEXT.not_evaluated) : null,
      f.pin ? `${L("at the pin", "en el pin")}: ${t(f.pin.value)}` : null,
      f.constraint === "protection" ? L("protection constraint", "restricción de protección") : null,
    ].filter(Boolean).join(" · ");
    const detail = [
      ...(f.detail && f.detail[lang] !== main ? [f.detail[lang]] : []),
      ...(f.coverage && (f.coverage.parts.length > 1 || f.coverage.parts.some((x) => x.small)) ? [f.coverage.parts.map((x) => `${t(x.label)}: ${x.area_text} (${x.share_text})${x.small ? ` — ${L("small intersection", "intersección pequeña")}` : ""}`).join("; ")] : []),
      ...(f.notes ?? []).map((n) => n[lang]),
      ...(f.ambiguities ?? []).map((a) => `${L("Ambiguity", "Ambigüedad")}: ${a[lang]}`),
      ...(f.currency?.status === "unresolved" ? [`${L("Source currency unresolved", "Vigencia de la fuente sin resolver")}: ${t(f.currency.reason)}`] : []),
    ];
    const s = f.sources[0];
    const srcText = [
      f.sources.map((x) => `${x.name}${x.dataset_date ? ` (${x.dataset_date})` : ""}`).join("; "),
      f.retrieval ? RETRIEVAL_TEXT[f.retrieval][lang] : null,
      f.looked_up_at ? `${L("looked up", "consultado")} ${f.looked_up_at.slice(0, 10)}` : null,
    ].filter(Boolean).join(" · ");
    return { title: t(f.title), value: main, tone: answered ? f.tone : "unknown", meta, detail: [...new Set(detail)].filter(Boolean), source: srcText || s?.url ? { text: srcText, url: s?.url ?? null } : null };
  };
  section("details", L("Detailed site findings", "Hallazgos detallados del lugar"), GROUPS.map(([g, en, es]) => ({ label: L(en, es), tone: null, layout: "rows" as const, items: report.findings.filter((f) => f.group === g).map(row) })));

  // ---- Land-use evaluation details ---------------------------------------------------
  const lu = report.land_use?.activity.use ? report.land_use : null;
  if (lu) {
    const paras = [
      `"${lu.activity.raw}" — ${lu.activity.useName}`,
      `${L("Compatibility", "Compatibilidad")}: ${lu.decision ? t(lu.decision.compatibility.label) : `${COMPATIBILITY_TEXT[lu.compatibility.outcome][lang]} (${L("confidence", "confianza")} ${lu.compatibility.confidence})`}`,
      ...lu.compatibility.reasons.map((x) => `• ${x}`),
      ...lu.districts.filter((d) => !d.sliver && d.conditions.length).flatMap((d) => d.conditions.map((x) => `– ${d.code}: ${x}`)),
      ...lu.standards.map((s) => `${L("Standard", "Parámetro")} — ${s.name}: ${s.value} (${s.citation})`),
      ...lu.unresolved.map((u) => `${L("Unresolved", "Sin resolver")}: ${u.text}`),
    ];
    const approvals: DocItem[] = lu.approvals.map((a) => {
      const rq = a.requirement ?? (a.status === "confirmed" ? "required" : a.status === "likely" ? "potentially_required" : "unresolved");
      return {
        title: a.name, value: REQUIREMENT_TEXT[rq][lang], tone: rq === "required" ? "hazard" : rq === "potentially_required" ? "attention" : "info",
        meta: `${L("Trigger", "Motivo")}: ${a.needs ? L(`unknown — depends on ${a.needs.en}`, `desconocido — depende de ${a.needs.es}`) : a.trigger}`,
        detail: [
          ...(a.agency ? [`${L("Authority", "Autoridad")}: ${a.agency}`] : []),
          ...(a.citation ? [`${L("Provision", "Disposición")}: ${a.citation}`] : []),
          ...(a.citationGap ? [`${L("Evidence gap", "Brecha de evidencia")}: ${t(a.citationGap)}`] : []),
          ...(a.prerequisites ?? []).map((x) => `${L("Prerequisite", "Requisito previo")}: ${x}`),
          ...(a.sequence ? [`${L("Sequence", "Secuencia")}: ${a.sequence}`] : []),
          ...a.evidence.map((e) => `${L("Evidence", "Evidencia")}: ${e}`),
        ],
        source: a.sources[0] ? { text: a.sources.map((x) => x.name).join("; "), url: a.sources[0].url } : null,
      };
    });
    section("land_use", L("Land-use evaluation details", "Detalles de la evaluación de uso"), [{ label: L("Potential approvals", "Aprobaciones posibles"), tone: null, layout: "rows", items: approvals }], paras);
  }

  // ---- Professional review ------------------------------------------------------------
  if (review && (review.notes.length || review.open_questions.length || review.resolved_questions.length || review.status !== "draft")) {
    section("review", L("Professional review", "Revisión profesional"), [], [
      `${review.status_text[lang]}${review.reviewed_at ? ` · ${review.reviewed_by?.name ?? ""} · ${review.reviewed_at.slice(0, 10)}` : ""}`,
      review.disclaimer[lang],
      ...review.notes.map((n) => `• ${L("Note", "Nota")}${n.finding_id ? ` [${n.finding_id}]` : ""}: ${n.text}${n.author ? ` — ${n.author}` : ""}`),
      ...review.open_questions.map((q) => `• ${L("Open question", "Pregunta pendiente")}${q.finding_id ? ` [${q.finding_id}]` : ""}: ${q.text}`),
      ...review.resolved_questions.map((q) => `• ${L("Resolved", "Resuelta")}: ${q.text} -> ${q.resolution}`),
    ]);
  }

  // ---- Sources & technical ----------------------------------------------------------------
  section("sources", L("Sources", "Fuentes"), [{ label: null, tone: null, layout: "bullets", items: report.sources.map((s) => ({ title: s.name, value: [s.dataset_date ? `${L("data", "datos")} ${s.dataset_date}` : null, s.version].filter(Boolean).join(" · "), tone: "info" as ReportTone, source: s.url ? { text: "", url: s.url } : null })) }]);
  const nad = p.technical.nad83_state_plane;
  section("technical", L("Technical coordinates & versions", "Coordenadas técnicas y versiones"), [], [
    `${nad.crs ?? "NAD83 / Puerto Rico & Virgin Is. (EPSG:32161)"}: X ${nad.x.toLocaleString("en-US")} m, Y ${nad.y.toLocaleString("en-US")} m (${L("units", "unidades")}: ${nad.units ?? "metres"}${nad.projection ? `; ${nad.projection}` : ""}). ${t(nad.note)}${nad.datum_note ? ` ${t(nad.datum_note)}` : ""}`,
    `WGS84 (EPSG:4326): ${p.latitude.toFixed(7)}, ${p.longitude.toFixed(7)}`,
    ...(report.regulation ? [`${L("Regulation for use rules", "Reglamento para reglas de uso")}: ${report.regulation.name}${report.regulation.publication_date ? ` (${L("publication date", "fecha de publicación")} ${report.regulation.publication_date})` : ""} — ${L("applicability to this site", "aplicabilidad a este lugar")}: ${report.regulation.applicability === "verified" ? L("verified", "verificada") : L("not verified", "no verificada")}. ${t(report.regulation.note)}`] : []),
    ...(report.versions ? [`${L("Area method", "Método de áreas")}: ${report.versions.coverage_method}`, `${L("Rules", "Reglas")}: ${report.versions.rules}`] : []),
    ...(report.schema !== "smartpr.property-report/v3" ? [L(`Saved with an earlier report format (${report.schema}); shown as saved, not re-evaluated.`, `Guardado con un formato anterior (${report.schema}); se muestra tal como se guardó, sin reevaluar.`)] : []),
  ]);

  const loc = p.location;
  return {
    lang,
    title: p.title,
    address: `${p.address.primary} · ${p.address.secondary}`,
    generated: `${L("Generated", "Generado")} ${report.generated_at}`,
    facts: [
      [L("Municipality", "Municipio"), p.municipality],
      [L("Barrio", "Barrio"), p.barrio ?? "—"],
      [L("Catastro", "Catastro"), p.catastro.text?.[lang] ?? p.catastro.value ?? findingStateText(p.catastro.state)[lang]],
      [L("Approx. area", "Área aprox."), area.text[lang]],
      [L("Coordinates (WGS84)", "Coordenadas (WGS84)"), `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`],
      [L("Report", "Informe"), `${report.fingerprint} · ${report.schema.replace("smartpr.property-report/", "")} · ${L("rev.", "rev.")} ${report.location_revision}`],
    ],
    areaNote: `${L("Area", "Área")}: ${area.note[lang]}`,
    preliminary: loc?.preliminary && loc.parcel !== "loading" ? L("PRELIMINARY — SELECTED POINT ONLY", "PRELIMINAR — SOLO EL PUNTO SELECCIONADO") : null,
    notices: (loc?.notices ?? []).map((n) => ({ text: n[lang], warn: !!loc?.roadway })),
    review: review ? { label: `${review.status_text[lang]} — ${L("not a government approval", "no es aprobación del gobierno")}`, tone: review.status === "reviewed" ? "ok" : review.status === "under_review" ? "attention" : "unknown" } : null,
    conclusion: A.conclusion[lang],
    sections,
    snapshot: snapshotLine(report, lang),
    disclaimer: report.disclaimer[lang],
    fileName: `property-report-${(p.catastro.value ?? p.municipality).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`,
  };
}

/** "Copy full report": the whole document as plain text (every section, every finding). */
export function reportDocumentText(d: ReportDocument): string {
  const out: string[] = [
    `${d.lang === "es" ? "Informe de propiedad y lugar" : "Property & Site Report"} — ${d.title}`,
    d.address,
    d.snapshot,
    ...(d.review ? [d.review.label] : []),
    ...(d.preliminary ? [d.preliminary] : []),
    ...d.notices.map((n) => `! ${n.text}`),
    ...d.facts.map(([k, v]) => `${k}: ${v}`),
    d.areaNote,
    "",
    d.conclusion,
  ];
  for (const s of d.sections) {
    out.push("", s.title.toUpperCase());
    for (const p of s.paragraphs) out.push(p);
    for (const g of s.groups) {
      if (g.label) out.push(`${g.label}:`);
      for (const it of g.items) {
        out.push(`• ${it.title}${it.value ? `: ${it.value}` : ""}`);
        if (it.meta) out.push(`  ${it.meta}`);
        for (const x of it.detail ?? []) out.push(`  ${x}`);
        if (it.source && (it.source.text || it.source.url)) out.push(`  [${[it.source.text, it.source.url].filter(Boolean).join(" ")}]`);
      }
    }
  }
  out.push("", d.disclaimer);
  return out.join("\n");
}
