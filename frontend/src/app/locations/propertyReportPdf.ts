// ============================================================================
// Property & Site Report → designed PDF (client-side, jsPDF).
// Same PropertyReport model as the preview / drawer / Passport copy.
// Layout: teal title band · key facts · colour-coded "at a glance" pills ·
// protection constraints (highlighted) · findings by group in plain language
// · next steps · professional review (selected notes) · gaps · sources.
// ============================================================================

import type { jsPDF as JsPDF } from "jspdf";
import { findingStateText, type PropertyReport, type ReportFinding, type ReportTone } from "./propertyReport";
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
const safe = (t: string) =>
  t.replace(/[→⇒]/g, "->").replace(/[≈]/g, "~").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xFF—–•…]/g, "");

export async function downloadPropertyReportPdf(report: PropertyReport, lang: Lang, review: ReturnType<typeof exportableReview>) {
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
  const facts: Array<[string, string]> = [
    [L("Municipality", "Municipio"), p.municipality],
    [L("Barrio", "Barrio"), p.barrio ?? "—"],
    [L("Catastro", "Catastro"), p.catastro.value ?? findingStateText(p.catastro.state)[lang]],
    [L("Approx. area", "Área aprox."), p.boundary.area_m2 ? `${p.boundary.area_m2.toLocaleString("en-US")} m² (${(p.boundary.area_m2 / 3930.395).toFixed(2)} ${L("cuerdas", "cuerdas")})` : findingStateText(p.boundary.state)[lang]],
    [L("Coordinates", "Coordenadas"), `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`],
    ["NAD83 PR State Plane", `X ${p.technical.nad83_state_plane.x.toLocaleString("en-US")} · Y ${p.technical.nad83_state_plane.y.toLocaleString("en-US")} m`],
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
  if (p.boundary.area_m2) para(L("Area from the mapped CRIM boundary — not a survey.", "Área del límite mapeado del CRIM — no es una mensura."), 7.5, "italic", MUTED);

  // ---- At a glance -----------------------------------------------------------
  heading(L("At a glance", "Resumen"));
  const glance = report.findings.filter((f) => f.pill && (f.state === "sourced" || f.state === "none_mapped"));
  let x = M;
  ensure(10);
  for (const f of glance) {
    font(8.5, "bold");
    const w = doc.getTextWidth(safe(f.pill![lang])) + 8;
    if (x + w > W - M) { x = M; y += 8.5; ensure(9); }
    x += pill(x, y, f.pill![lang], f.tone) + 3;
  }
  y += 8;

  // ---- Protection constraints -------------------------------------------------
  const prot = report.next_steps.steps.filter((s) => s.constraint === "protection");
  if (prot.length) {
    ensure(24);
    const startY = y;
    const textW = CW - 12;
    const body = prot.flatMap((s) => lines(`• ${s.text[lang]}`, textW));
    const note = lines(prot[0]!.because[lang], textW);
    const h = 10 + body.length * lh(9.5) + 2 + note.length * lh(8);
    color(TONE.hazard.bg, "fill");
    color([243, 195, 178], "draw");
    doc.roundedRect(M, startY, CW, h, 2.5, 2.5, "FD");
    color(TONE.hazard.dot, "fill");
    doc.rect(M, startY, 1.6, h, "F");
    y = startY + 7;
    font(11, "bold", TONE.hazard.fg); doc.text(L("Protection constraints", "Restricciones de protección"), M + 6, y); y += 6;
    font(9.5, "normal", INK); for (const ln of body) { doc.text(ln, M + 6, y); y += lh(9.5); }
    y += 1;
    font(8, "italic", TONE.hazard.fg); for (const ln of note) { doc.text(ln, M + 6, y); y += lh(8); }
    y = startY + h + 4;
  }

  // ---- Findings ----------------------------------------------------------------
  const groups: Array<[string, string, string]> = [["land", "Land & zoning", "Terreno y calificación"], ["flood", "Flood & water", "Inundación y agua"], ["environment", "Environment & terrain", "Ambiente y terreno"]];
  const row = (f: ReportFinding) => {
    const tone = f.state === "sourced" || f.state === "none_mapped" ? f.tone : "unknown";
    const main = f.plain?.[lang] ?? (f.value ? f.value[lang] : findingStateText(f.state)[lang]);
    const sub = [f.value && f.plain ? f.value[lang] : null, f.state === "sourced" ? (f.scope === "parcel" ? L("whole parcel", "toda la parcela") : f.scope === "point" ? L("at the pin", "en el pin") : null) : null, f.constraint === "protection" ? L("PROTECTION", "PROTECCIÓN") : f.constraint === "documentation" ? L("review / documentation", "revisión / documentación") : null].filter(Boolean).join(" · ");
    const src = f.sources.map((s) => `${s.name}${s.dataset_date ? ` (${s.dataset_date})` : ""}`).join("; ");
    const mainL = lines(main, CW - 62);
    const subL = sub ? lines(sub, CW - 62) : [];
    const srcL = src ? lines(src, CW - 62) : [];
    const h = Math.max(7, mainL.length * lh(9.5) + subL.length * lh(8) + srcL.length * lh(7) + 3);
    ensure(h + 2);
    color(TONE[tone].dot, "fill"); doc.circle(M + 1.6, y - 1.2, 1.4, "F");
    font(9, "bold", MUTED);
    lines(f.title[lang], 50).forEach((ln, i) => doc.text(ln, M + 5, y + i * lh(9)));
    let yy = y;
    font(9.5, "normal", INK); for (const ln of mainL) { doc.text(ln, M + 60, yy); yy += lh(9.5); }
    font(8, "bold", TONE[tone].fg); for (const ln of subL) { doc.text(ln, M + 60, yy); yy += lh(8); }
    font(7, "normal", [140, 150, 155]); for (const ln of srcL) { doc.text(ln, M + 60, yy); yy += lh(7); }
    y = Math.max(yy, y + lines(f.title[lang], 50).length * lh(9)) + 2;
    color([240, 236, 228], "draw"); doc.setLineWidth(0.2); doc.line(M, y - 1, W - M, y - 1);
    y += 2.5;
  };
  for (const [g, en, es] of groups) {
    heading(L(en, es));
    for (const f of report.findings.filter((x) => x.group === g)) row(f);
  }

  // ---- Next steps --------------------------------------------------------------
  heading(L("Next steps", "Próximos pasos"));
  para(report.next_steps.activity[lang], 9.5, "italic", MUTED);
  y += 1;
  for (const [c, en, es] of [["documentation", "Reviews that may be met with documentation", "Revisiones que pueden atenderse con documentación"], ["information", "Preparation steps", "Pasos de preparación"]] as const) {
    const list = report.next_steps.steps.filter((s) => s.constraint === c);
    if (!list.length) continue;
    para(L(en, es), 10, "bold", TEAL);
    list.forEach((s, i) => {
      para(`${i + 1}. ${s.text[lang]}`, 9.5, "normal", INK, M + 3, CW - 3);
      para(`${L("Why", "Por qué")}: ${s.because[lang]} — ${s.sources.map((x) => x.name).join("; ")}`, 7.5, "normal", MUTED, M + 7, CW - 7);
      y += 1;
    });
  }
  if (report.next_steps.location_requirements.length) {
    para(L("Requirements that depend on this location", "Requisitos que dependen de esta ubicación"), 10, "bold", TEAL);
    for (const r of report.next_steps.location_requirements) para(`• ${r.title}`, 9.5, "normal", INK, M + 3, CW - 3);
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

  // ---- Gaps ------------------------------------------------------------------------
  const gaps = [...report.next_steps.missing, ...report.next_steps.unresolved];
  if (gaps.length) {
    heading(L("Missing information & checks not completed", "Información faltante y verificaciones pendientes"));
    for (const g of gaps) para(`• ${g[lang]}`, 9, "normal", MUTED, M + 3, CW - 3);
  }

  // ---- Sources -----------------------------------------------------------------------
  heading(L("Sources", "Fuentes"));
  for (const s of report.sources) para(`${s.name}${s.dataset_date ? ` · ${L("data", "datos")} ${s.dataset_date}` : ""}${s.url ? `  ${s.url}` : ""}`, 7.5, "normal", MUTED);

  // ---- Footer on every page --------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    color(LINE, "draw"); doc.setLineWidth(0.3); doc.line(M, H - 12, W - M, H - 12);
    font(7, "normal", MUTED);
    doc.text(lines(report.disclaimer[lang], CW - 20)[0] ?? "", M, H - 7.5);
    doc.text(`${i} / ${pages}`, W - M, H - 7.5, { align: "right" });
  }
  doc.save(`property-report-${(report.property.catastro.value ?? report.property.municipality).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`);
}
