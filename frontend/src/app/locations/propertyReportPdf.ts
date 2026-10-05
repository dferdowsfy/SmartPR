// ============================================================================
// Property & Site Report → designed PDF (client-side, jsPDF).
// Same PropertyReport model as the preview / drawer / Passport copy.
// Layout: teal title band · key facts · colour-coded "at a glance" pills ·
// protection constraints (highlighted) · findings by group in plain language
// · next steps · professional review (selected notes) · gaps · sources.
// ============================================================================

import type { jsPDF as JsPDF } from "jspdf";
import { assessmentOf, BASIS_TEXT, basisOf, findingStateText, reportArea, RETRIEVAL_TEXT, SCOPE_TEXT, type PropertyReport, type ReportFinding, type ReportTone } from "./propertyReport";
import { COMPATIBILITY_TEXT } from "./landUse";
import type { exportableReview } from "./propertyReview";

type Lang = "en" | "es";
type Rgb = [number, number, number];
const TEAL: Rgb = [31, 107, 102];
const INK: Rgb = [21, 47, 53];
const MUTED: Rgb = [93, 107, 114];
const LINE: Rgb = [227, 222, 211];
const TONE: Record<ReportTone, { bg: Rgb; fg: Rgb; dot: Rgb }> = {
  ok: { bg: [231, 245, 236], fg: [29, 107, 58], dot: [46, 157, 91] },
  info: { bg: [232, 239, 251], fg: [36, 80, 143], dot: [58, 111, 196] },
  attention: { bg: [253, 243, 220], fg: [122, 82, 0], dot: [215, 154, 22] },
  hazard: { bg: [253, 233, 226], fg: [154, 46, 14], dot: [194, 65, 12] },
  unknown: { bg: [242, 239, 231], fg: [93, 107, 114], dot: [185, 196, 194] },
};

/** jsPDF's built-in fonts are WinAnsi: replace what they can't draw. */
export const pdfSafeText = (t: string) =>
  t.replace(/[→⇒]/g, "->").replace(/[≈]/g, "~").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xFF—–•…]/g, "");
const safe = pdfSafeText;

export async function downloadPropertyReportPdf(report: PropertyReport, lang: Lang, review: ReturnType<typeof exportableReview>) {
  const doc = await renderPropertyReportPdf(report, lang, review);
  doc.save(propertyReportFileName(report, "pdf"));
}

/** Export file name — same for the PDF and the JSON download. */
export function propertyReportFileName(report: PropertyReport, ext: "pdf" | "json"): string {
  return `property-report-${(report.property.catastro.value ?? report.property.municipality).replace(/[^A-Za-z0-9-]+/g, "-")}.${ext}`;
}

/** Build the PDF (no download): the consistency tests read its text back. */
export async function renderPropertyReportPdf(report: PropertyReport, lang: Lang, review: ReturnType<typeof exportableReview>): Promise<JsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc: JsPDF = new jsPDF({ unit: "mm", format: "letter" });
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const CW = W - 2 * M;
  let y = 0;

  const color = (c: Rgb, kind: "text" | "fill" | "draw" = "text") =>
    kind === "text" ? doc.setTextColor(c[0], c[1], c[2]) : kind === "fill" ? doc.setFillColor(c[0], c[1], c[2]) : doc.setDrawColor(c[0], c[1], c[2]);
  const font = (size: number, style: "normal" | "bold" | "italic" = "normal", c: Rgb = INK) => { doc.setFont("helvetica", style); doc.setFontSize(size); color(c); };
  const lines = (t: string, w: number) => doc.splitTextToSize(safe(t), w) as string[];
  const lh = (size: number) => size * 0.42 + 1.2;
  const ensure = (h: number) => { if (y + h > H - 18) { doc.addPage(); y = 18; } };
  const para = (t: string, size = 10, style: "normal" | "bold" | "italic" = "normal", c: Rgb = INK, x = M, w = CW) => {
    font(size, style, c);
    for (const ln of lines(t, w)) { ensure(lh(size)); doc.text(ln, x, y); y += lh(size); }
  };
  const heading = (t: string) => {
    ensure(16);
    y += 4;
    font(13, "bold", TEAL);
    doc.text(safe(t), M, y);
    y += 2.5;
    color(LINE, "draw"); doc.setLineWidth(0.4); doc.line(M, y, W - M, y);
    y += 6;
  };
  const pill = (x: number, yy: number, text: string, tone: ReportTone) => {
    font(8.5, "bold", TONE[tone].fg);
    const tw = doc.getTextWidth(safe(text)) + 8;
    color(TONE[tone].bg, "fill");
    doc.roundedRect(x, yy - 4.2, tw, 6.4, 3.2, 3.2, "F");
    color(TONE[tone].dot, "fill");
    doc.circle(x + 3.2, yy - 1, 1.1, "F");
    doc.text(safe(text), x + 5.6, yy);
    return tw;
  };

  // ---- Title band ----------------------------------------------------------
  color(TEAL, "fill");
  doc.rect(0, 0, W, 38, "F");
  font(9, "bold", [207, 232, 228]);
  doc.text(L("PROPERTY & SITE REPORT", "INFORME DE PROPIEDAD Y LUGAR"), M, 11);
  font(20, "bold", [255, 255, 255]);
  doc.text(safe(report.property.title), M, 21);
  font(10, "normal", [225, 240, 237]);
  doc.text(safe(`${report.property.address.primary} · ${report.property.address.secondary}`), M, 28);
  font(8, "normal", [207, 232, 228]);
  doc.text(safe(`${L("Generated", "Generado")} ${new Date(report.generated_at).toLocaleString(lang === "es" ? "es-PR" : "en-US")}  ·  ${L("Report", "Informe")} ${report.fingerprint}`), M, 34);
  if (review) {
    const tone: ReportTone = review.status === "reviewed" ? "ok" : review.status === "under_review" ? "attention" : "unknown";
    const label = `${review.status_text[lang]} — ${L("not a government approval", "no es aprobación del gobierno")}`;
    font(8.5, "bold");
    pill(W - M - doc.getTextWidth(safe(label)) - 8, 12, label, tone);
  }
  y = 48;

  // ---- Key facts -------------------------------------------------------------
  const p = report.property;
  const area = reportArea(report);
  const facts: Array<[string, string]> = [
    [L("Municipality", "Municipio"), p.municipality],
    [L("Barrio", "Barrio"), p.barrio ?? "—"],
    [L("Catastro", "Catastro"), p.catastro.text?.[lang] ?? p.catastro.value ?? findingStateText(p.catastro.state)[lang]],
    [L("Approx. area", "Área aprox."), area.text[lang]],
    [L("Coordinates (WGS84)", "Coordenadas (WGS84)"), `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`],
    [L("Report", "Informe"), `${report.schema.replace("smartpr.property-report/", "")} · ${L("rev.", "rev.")} ${report.location_revision}`],
  ];
  color([250, 248, 243], "fill");
  color(LINE, "draw");
  const boxH = Math.ceil(facts.length / 2) * 11 + 4;
  doc.roundedRect(M, y - 5, CW, boxH, 2.5, 2.5, "FD");
  facts.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + 5 + col * (CW / 2);
    const yy = y + 1 + row * 11;
    font(7.5, "bold", MUTED); doc.text(safe(k.toUpperCase()), x, yy);
    font(10, "bold", INK); doc.text(safe(v), x, yy + 5);
  });
  y += boxH + 2;
  para(`${L("Area", "Área")}: ${area.note[lang]}`, 7.5, "italic", MUTED);

  // ---- Location validation ------------------------------------------------------------
  if (p.location?.notices.length) {
    if (p.location.preliminary) para(L("PRELIMINARY — SELECTED POINT ONLY", "PRELIMINAR — SOLO EL PUNTO SELECCIONADO"), 9.5, "bold", TONE.attention.fg);
    for (const n of p.location.notices) para(n[lang], 9.5, "normal", p.location.roadway ? TONE.attention.fg : INK);
    y += 2;
  }

  // ---- Reviewer conclusion ----------------------------------------------------------
  const A = assessmentOf(report);
  ensure(20);
  color([243, 248, 247], "fill");
  const concl = lines(A.conclusion[lang], CW - 10);
  const ch = concl.length * lh(10.5) + 6;
  doc.roundedRect(M, y - 2, CW, ch, 2, 2, "F");
  color(TEAL, "fill"); doc.rect(M, y - 2, 1.4, ch, "F");
  font(10.5, "normal", INK); concl.forEach((ln, i) => doc.text(ln, M + 5, y + 3 + i * lh(10.5)));
  y += ch + 2;

  // ---- Key regulatory findings -------------------------------------------------------
  heading(L("Key regulatory findings", "Hallazgos regulatorios clave"));
  const GROUP: Array<["review" | "clear" | "unable", string, string, ReportTone]> = [["review", "REVIEW REQUIRED", "REQUIERE REVISIÓN", "attention"], ["clear", "NO MAPPED INTERSECTION IDENTIFIED", "NO SE IDENTIFICÓ INTERSECCIÓN MAPEADA", "ok"], ["unable", "UNABLE TO VERIFY", "NO SE PUDO VERIFICAR", "unknown"]];
  for (const [k, en, es, tone] of GROUP) {
    if (!A[k].length) continue;
    ensure(10);
    pill(M, y, L(en, es), tone);
    y += 6;
    for (const x of A[k]) {
      para(`• ${x.label[lang]}: ${x.value[lang]}`, 9.5, x.severe ? "bold" : "normal", x.severe ? TONE.hazard.fg : INK, M + 3, CW - 3);
      const m = [x.scope ? SCOPE_TEXT[x.scope][lang] : null, x.dataset ? `${x.dataset.name}${x.dataset.date ? ` (${x.dataset.date})` : ""}` : null].filter(Boolean).join(" · ");
      if (m) para(m, 7.5, "normal", MUTED, M + 6, CW - 6);
    }
    y += 2;
  }

  // ---- Recommended next steps ---------------------------------------------------------
  heading(L("Recommended next steps", "Próximos pasos recomendados"));
  if (!A.actions.length) para(L("No actions identified from the available map sources.", "No se identificaron acciones con las fuentes disponibles."), 9.5, "italic", MUTED);
  A.actions.forEach((x, i) => {
    para(`${i + 1}. ${x.issue[lang]}`, 10, "bold", INK);
    para(x.action[lang], 9.5, "normal", INK, M + 5, CW - 5);
    if (x.sources.length) para(`${L("Sources", "Fuentes")}: ${x.sources.map((s) => s.name).join("; ")}`, 7.5, "normal", MUTED, M + 5, CW - 5);
    y += 1.5;
  });
  if (A.still_needed.length) {
    heading(L("Still needed", "Aún falta"));
    for (const x of A.still_needed) para(`• ${x.title[lang]}: ${x.text[lang]}`, 9.5, "normal", INK, M + 3, CW - 3);
  }

  // ---- Findings ----------------------------------------------------------------
  const groups: Array<[string, string, string]> = [["land", "Land & zoning", "Terreno y calificación"], ["flood", "Flood & water", "Inundación y agua"], ["environment", "Environment & terrain", "Ambiente y terreno"]];
  const row = (f: ReportFinding) => {
    const tone = f.state === "sourced" || f.state === "none_mapped" ? f.tone : "unknown";
    const answered = f.state === "sourced" || f.state === "none_mapped";
    const main = answered ? f.plain?.[lang] ?? (f.value ? f.value[lang] : findingStateText(f.state)[lang]) : findingStateText(f.state)[lang];
    const sub = [
      f.value && answered && f.plain ? f.value[lang] : null,
      BASIS_TEXT[basisOf(f)][lang],
      f.state === "sourced" || f.state === "none_mapped" ? SCOPE_TEXT[f.scope][lang] : null,
      f.pin ? `${L("at the pin", "en el pin")}: ${f.pin.value[lang]}` : null,
      f.constraint === "protection" ? L("PROTECTION", "PROTECCIÓN") : f.constraint === "documentation" ? L("mapped constraint", "restricción mapeada") : null,
    ].filter(Boolean).join(" · ");
    const extra = [
      ...(f.state === "unavailable" && f.detail ? [f.detail[lang]] : []),
      ...(f.coverage && f.coverage.parts.length > 1 || f.coverage?.parts.some((x) => x.small) ? [f.coverage.parts.map((x) => `${x.label[lang]}: ${x.area_text} (${x.share_text})${x.small ? ` — ${L("small intersection", "intersección pequeña")}` : ""}`).join("; ")] : []),
      ...(f.notes ?? []).map((n) => n[lang]),
      ...(f.ambiguities ?? []).map((a) => `${L("Ambiguity", "Ambigüedad")}: ${a[lang]}`),
    ].join(" ");
    const src = f.sources.map((s) => `${s.name}${s.dataset_date ? ` (${s.dataset_date})` : ""}`).join("; ") + (f.retrieval ? ` · ${RETRIEVAL_TEXT[f.retrieval][lang]}` : "") + (f.looked_up_at ? ` · ${L("looked up", "consultado")} ${f.looked_up_at.slice(0, 10)}` : "") + (f.sources[0]?.url ? ` · ${f.sources[0].url}` : "");
    // Wrap each block with the font it is drawn in (wrapping with whatever font
    // the previous row left set overflowed the right margin and clipped text).
    font(9.5, "normal"); const mainL = lines(main, CW - 62);
    font(8, "bold"); const subL = sub ? lines(sub, CW - 62) : [];
    font(7.5, "normal"); const extraL = extra ? lines(extra, CW - 62) : [];
    font(7, "normal"); const srcL = src ? lines(src, CW - 62) : [];
    const h = Math.max(7, mainL.length * lh(9.5) + subL.length * lh(8) + extraL.length * lh(7.5) + srcL.length * lh(7) + 3);
    ensure(h + 2);
    color(TONE[tone].dot, "fill"); doc.circle(M + 1.6, y - 1.2, 1.4, "F");
    font(9, "bold", MUTED);
    lines(f.title[lang], 50).forEach((ln, i) => doc.text(ln, M + 5, y + i * lh(9)));
    let yy = y;
    font(9.5, "normal", INK); for (const ln of mainL) { doc.text(ln, M + 60, yy); yy += lh(9.5); }
    font(8, "bold", TONE[tone].fg); for (const ln of subL) { doc.text(ln, M + 60, yy); yy += lh(8); }
    font(7.5, "normal", MUTED); for (const ln of extraL) { doc.text(ln, M + 60, yy); yy += lh(7.5); }
    font(7, "normal", [140, 150, 155]); for (const ln of srcL) { doc.text(ln, M + 60, yy); yy += lh(7); }
    y = Math.max(yy, y + lines(f.title[lang], 50).length * lh(9)) + 2;
    color([240, 236, 228], "draw"); doc.setLineWidth(0.2); doc.line(M, y - 1, W - M, y - 1);
    y += 2.5;
  };
  heading(L("Detailed site findings", "Hallazgos detallados del lugar"));
  for (const [g, en, es] of groups) {
    para(L(en, es), 11, "bold", TEAL);
    y += 1;
    for (const f of report.findings.filter((x) => x.group === g)) row(f);
  }

  // ---- Regulatory flags + land use -------------------------------------------------
  const lu = report.land_use;
  if (lu?.activity.use) {
    heading(L("Land-use evaluation details", "Detalles de la evaluación de uso"));
    para(`"${lu.activity.raw}" — ${lu.activity.useName}`, 10, "italic", MUTED);
    const o = lu.compatibility.outcome;
    const tone: ReportTone = o === "permitted" ? "ok" : o === "potentially_prohibited" ? "hazard" : o === "insufficient" ? "unknown" : "attention";
    ensure(10);
    pill(M, y + 1, `${L("Compatibility", "Compatibilidad")}: ${COMPATIBILITY_TEXT[o][lang]} · ${L("confidence", "confianza")} ${lu.compatibility.confidence}`, tone);
    y += 8;
    for (const x of lu.compatibility.reasons) para(`• ${x}`, 9.5, "normal", INK, M + 3, CW - 3);
    for (const d of lu.districts.filter((d) => !d.sliver && d.conditions.length)) for (const x of d.conditions) para(`– ${x}`, 9, "normal", MUTED, M + 6, CW - 6);
    heading(L("Required approvals", "Aprobaciones requeridas"));
    for (const a of lu.approvals) {
      const st = a.status === "confirmed" ? L("REQUIRED", "REQUERIDO") : a.status === "likely" ? L("LIKELY", "PROBABLE") : L("PROFESSIONAL REVIEW", "REVISIÓN PROFESIONAL");
      ensure(16);
      pill(M, y + 1, st, a.status === "confirmed" ? "hazard" : a.status === "likely" ? "attention" : "info");
      font(10, "bold", INK); doc.text(safe(a.name), M + 46, y + 1); y += 6;
      para(`${L("Trigger", "Motivo")}: ${a.trigger}`, 9, "normal", INK, M + 3, CW - 3);
      if (a.agency) para(`${L("Agency", "Agencia")}: ${a.agency}`, 8.5, "normal", MUTED, M + 3, CW - 3);
      if (a.sources.length || a.citation) para(`${L("Authority", "Autoridad")}: ${a.sources.map((x) => x.name).join("; ")}${a.citation ? ` — ${a.citation}` : ""}`, 8, "normal", MUTED, M + 3, CW - 3);
      for (const e of a.evidence) para(`  ✓ ${e}`.replace("✓", "-"), 8.5, "normal", INK, M + 6, CW - 6);
      y += 2;
    }
    if (lu.unresolved.length) {
      heading(L("Unresolved items", "Asuntos sin resolver"));
      for (const u of lu.unresolved) para(`• ${u.text}`, 9, "normal", MUTED, M + 3, CW - 3);
    }
  }

  // ---- Professional review ------------------------------------------------------
  if (review && (review.notes.length || review.open_questions.length || review.resolved_questions.length || review.status !== "draft")) {
    heading(L("Professional review", "Revisión profesional"));
    para(`${review.status_text[lang]}${review.reviewed_at ? ` · ${review.reviewed_by?.name ?? ""} · ${review.reviewed_at.slice(0, 10)}` : ""}`, 10, "bold");
    para(review.disclaimer[lang], 8, "italic", MUTED);
    for (const n of review.notes) para(`• ${L("Note", "Nota")}${n.finding_id ? ` [${n.finding_id}]` : ""}: ${n.text}${n.author ? ` — ${n.author}` : ""}`, 9.5, "normal", INK, M + 3, CW - 3);
    for (const q of review.open_questions) para(`• ${L("Open question", "Pregunta pendiente")}: ${q.text}`, 9.5, "bold", TONE.attention.fg, M + 3, CW - 3);
    for (const q of review.resolved_questions) para(`• ${L("Resolved", "Resuelta")}: ${q.text} -> ${q.resolution}`, 9.5, "normal", INK, M + 3, CW - 3);
  }

  // ---- Sources -----------------------------------------------------------------------
  heading(L("Sources", "Fuentes"));
  for (const s of report.sources) para(`${s.name}${s.dataset_date ? ` · ${L("data", "datos")} ${s.dataset_date}` : ""}${s.version ? ` · ${s.version}` : ""}${s.url ? `  ${s.url}` : ""}`, 7.5, "normal", MUTED);

  // ---- Technical -----------------------------------------------------------------------
  heading(L("Technical coordinates & versions", "Coordenadas técnicas y versiones"));
  const nad = p.technical.nad83_state_plane;
  para(`${nad.crs ?? "NAD83 / Puerto Rico & Virgin Is. (EPSG:32161)"}: X ${nad.x.toLocaleString("en-US")} m, Y ${nad.y.toLocaleString("en-US")} m (${L("units", "unidades")}: ${nad.units ?? "metres"}${nad.projection ? `; ${nad.projection}` : ""}).`, 8.5, "normal", INK);
  para(`${nad.note[lang]}${nad.datum_note ? ` ${nad.datum_note[lang]}` : ""}`, 7.5, "italic", MUTED);
  para(`WGS84 (EPSG:4326): ${p.latitude.toFixed(7)}, ${p.longitude.toFixed(7)}`, 8.5, "normal", INK);
  if (report.regulation) para(`${L("Regulation for use rules", "Reglamento para reglas de uso")}: ${report.regulation.name}${report.regulation.publication_date ? ` (${L("publication date", "fecha de publicación")} ${report.regulation.publication_date})` : ""} — ${L("applicability to this site", "aplicabilidad a este lugar")}: ${report.regulation.applicability === "verified" ? L("verified", "verificada") : L("not verified", "no verificada")}. ${report.regulation.note[lang]}`, 7.5, "normal", MUTED);
  if (report.versions) para(`${L("Area method", "Método de áreas")}: ${report.versions.coverage_method} ${L("Rules", "Reglas")}: ${report.versions.rules}.`, 7.5, "normal", MUTED);
  para(`${report.schema} · ${L("report", "informe")} ${report.fingerprint} · ${L("location revision", "revisión de ubicación")} ${report.location_revision} · ${L("generated", "generado")} ${report.generated_at}`, 7.5, "normal", MUTED);

  // ---- Footer on every page --------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    color(LINE, "draw"); doc.setLineWidth(0.3); doc.line(M, H - 12, W - M, H - 12);
    font(7, "normal", MUTED);
    doc.text(lines(report.disclaimer[lang], CW - 20)[0] ?? "", M, H - 7.5);
    doc.text(`${i} / ${pages}`, W - M, H - 7.5, { align: "right" });
  }
  return doc;
}
