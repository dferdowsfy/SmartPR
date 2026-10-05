// ============================================================================
// Property & Site Report → PDF (jsPDF). Renders the shared ReportDocument
// (reportDocument.ts) — the same structure as "Copy full report" — so the PDF
// cannot drift from the screen and copied text.
//
// Layout rules (all locations, all states):
//  · every text block is measured with the font it is drawn in, inside the
//    printable width; long words / URLs are broken to fit;
//  · rows are drawn line by line and continue on the next page when they
//    reach the bottom margin (no clipping, no overlap with the footer);
//  · a heading is kept with at least its first lines (no orphans);
//  · source URLs are clickable link annotations; page numbers are written
//    after layout, so "n / N" is exact.
// ============================================================================

import type { jsPDF as JsPDF } from "jspdf";
import type { PropertyReport, ReportTone } from "./propertyReport";
import type { exportableReview } from "./propertyReview";
import { reportDocument, type DocItem, type ReportDocument } from "./reportDocument";

type Lang = "en" | "es";
type Rgb = [number, number, number];
type Style = "normal" | "bold" | "italic";
const TEAL: Rgb = [31, 107, 102];
const INK: Rgb = [21, 47, 53];
const MUTED: Rgb = [93, 107, 114];
const FAINT: Rgb = [120, 132, 136];
const LINK: Rgb = [24, 96, 160];
const LINE: Rgb = [227, 222, 211];
const TONE: Record<ReportTone, { bg: Rgb; fg: Rgb; dot: Rgb }> = {
  ok: { bg: [231, 245, 236], fg: [29, 107, 58], dot: [46, 157, 91] },
  info: { bg: [232, 239, 251], fg: [36, 80, 143], dot: [58, 111, 196] },
  attention: { bg: [253, 243, 220], fg: [122, 82, 0], dot: [215, 154, 22] },
  hazard: { bg: [253, 233, 226], fg: [154, 46, 14], dot: [194, 65, 12] },
  unknown: { bg: [242, 239, 231], fg: [93, 107, 114], dot: [185, 196, 194] },
};

/** jsPDF's built-in fonts are WinAnsi: replace what they can't draw (keeping meaning). */
export const pdfSafe = (t: string) =>
  t.replace(/[→⇒]/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/≈/g, "~").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/✓/g, "-").replace(/[   ]/g, " ").replace(/[^\x00-\xFF—–•…€]/g, "");

/** Lay the document out on a jsPDF instance (pure: no download). */
export function renderReportPdf(d: ReportDocument, doc: JsPDF): JsPDF {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const CW = W - 2 * M;
  const TOP = 18;
  const BOTTOM = H - 18; // footer rule at H - 12
  let y = 0;

  const color = (c: Rgb, kind: "text" | "fill" | "draw" = "text") =>
    kind === "text" ? doc.setTextColor(c[0], c[1], c[2]) : kind === "fill" ? doc.setFillColor(c[0], c[1], c[2]) : doc.setDrawColor(c[0], c[1], c[2]);
  const font = (size: number, style: Style = "normal", c: Rgb = INK) => { doc.setFont("helvetica", style); doc.setFontSize(size); color(c); };
  const lh = (size: number) => size * 0.42 + 1.2;
  /** Wrap with the font the text will be drawn in. splitTextToSize breaks words longer than the width. */
  const wrap = (t: string, w: number, size: number, style: Style = "normal") => { doc.setFont("helvetica", style); doc.setFontSize(size); return doc.splitTextToSize(pdfSafe(t), w - 1.5) as string[]; };
  const newPage = () => { doc.addPage(); y = TOP; };
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage(); };
  /** A paragraph that flows across pages line by line. */
  const para = (t: string, size = 10, style: Style = "normal", c: Rgb = INK, x = M, w = CW, link?: string | null) => {
    for (const ln of wrap(t, w, size, style)) {
      ensure(lh(size));
      font(size, style, c);
      doc.text(ln, x, y);
      if (link) doc.link(x, y - size * 0.35, doc.getTextWidth(ln), lh(size), { url: link });
      y += lh(size);
    }
  };
  const pill = (x: number, yy: number, text: string, tone: ReportTone, maxW = CW) => {
    const ls = wrap(text, maxW - 8, 8, "bold");
    font(8, "bold", TONE[tone].fg);
    const tw = Math.min(maxW, Math.max(...ls.map((l) => doc.getTextWidth(l))) + 8);
    const h = ls.length * lh(8) + 2.6;
    color(TONE[tone].bg, "fill");
    doc.roundedRect(x, yy - 4, tw, h, 2.5, 2.5, "F");
    color(TONE[tone].dot, "fill");
    doc.circle(x + 3, yy - 1, 1, "F");
    font(8, "bold", TONE[tone].fg);
    ls.forEach((l, i) => doc.text(l, x + 5.4, yy + i * lh(8)));
    return h;
  };
  /** Section heading kept with at least `keep` mm of what follows. */
  const heading = (t: string, keep = 14) => {
    ensure(12 + keep);
    y += 3;
    for (const ln of wrap(t, CW, 13, "bold")) { font(13, "bold", TEAL); doc.text(ln, M, y); y += lh(13); }
    y -= 2.5;
    color(LINE, "draw"); doc.setLineWidth(0.4); doc.line(M, y, W - M, y);
    y += 5.5;
  };
  const sourceLines = (it: DocItem, x: number, w: number) => {
    if (!it.source) return;
    if (it.source.text) para(it.source.text, 7, "normal", FAINT, x, w);
    if (it.source.url) para(it.source.url, 7, "normal", LINK, x, w, it.source.url);
  };
  const bullet = (it: DocItem, indent = 3) => {
    const x = M + indent, w = CW - indent;
    const head = it.value ? `• ${it.title}: ${it.value}` : `• ${it.title}`;
    ensure(lh(9.5) * Math.min(2, wrap(head, w, 9.5).length) + (it.meta ? lh(7.5) : 0));
    para(head, 9.5, it.severe ? "bold" : "normal", it.severe ? TONE.hazard.fg : INK, x, w);
    if (it.meta) para(it.meta, 7.5, "normal", MUTED, x + 3, w - 3);
    for (const dl of it.detail ?? []) para(dl, 7.5, "normal", MUTED, x + 3, w - 3);
    sourceLines(it, x + 3, w - 3);
    y += 0.8;
  };
  /** Two-column row: title left, content right; continues on the next page when needed. */
  const rowItem = (it: DocItem) => {
    const LW = 52, RX = M + LW + 6, RW = CW - LW - 6;
    type Ln = { t: string; size: number; style: Style; c: Rgb; link?: string | null };
    const right: Ln[] = [
      ...wrap(it.value, RW, 9.5).map((t) => ({ t, size: 9.5, style: "normal" as Style, c: INK })),
      ...(it.meta ? wrap(it.meta, RW, 8, "bold").map((t) => ({ t, size: 8, style: "bold" as Style, c: TONE[it.tone].fg })) : []),
      ...(it.detail ?? []).flatMap((x) => wrap(x, RW, 7.5).map((t) => ({ t, size: 7.5, style: "normal" as Style, c: MUTED }))),
      ...(it.source?.text ? wrap(it.source.text, RW, 7).map((t) => ({ t, size: 7, style: "normal" as Style, c: FAINT })) : []),
      ...(it.source?.url ? wrap(it.source.url, RW, 7).map((t) => ({ t, size: 7, style: "normal" as Style, c: LINK, link: it.source!.url })) : []),
    ];
    const left = wrap(it.title, LW - 5, 9, "bold");
    // Keep the title with at least three content lines.
    ensure(Math.max(left.length * lh(9), right.slice(0, 3).reduce((a, l) => a + lh(l.size), 0)) + 1);
    let yl = y, drawnLeft = 0;
    const drawLeft = () => {
      color(TONE[it.tone].dot, "fill"); doc.circle(M + 1.6, y - 1.2, 1.3, "F");
      font(9, "bold", MUTED);
      yl = y;
      for (; drawnLeft < left.length; drawnLeft++) { if (yl + lh(9) > BOTTOM) break; doc.text(left[drawnLeft]!, M + 5, yl); yl += lh(9); }
    };
    drawLeft();
    for (const ln of right) {
      if (y + lh(ln.size) > BOTTOM) { newPage(); if (drawnLeft < left.length) drawLeft(); else yl = y; }
      font(ln.size, ln.style, ln.c);
      doc.text(ln.t, RX, y);
      if (ln.link) doc.link(RX, y - ln.size * 0.35, doc.getTextWidth(ln.t), lh(ln.size), { url: ln.link });
      y += lh(ln.size);
    }
    y = Math.max(y, yl) + 1.5;
    if (y + 2 < BOTTOM) { color([240, 236, 228], "draw"); doc.setLineWidth(0.2); doc.line(M, y - 1, W - M, y - 1); }
    y += 2.5;
  };

  // ---- Title band (wrapped; grows with long names) ---------------------------------
  const titleL = wrap(d.title, CW - (d.review ? 70 : 0), 18, "bold");
  const addrL = wrap(d.address, CW, 10);
  const bandH = 14 + titleL.length * lh(18) + addrL.length * lh(10) + 8;
  color(TEAL, "fill"); doc.rect(0, 0, W, bandH, "F");
  font(9, "bold", [207, 232, 228]); doc.text(d.lang === "es" ? "INFORME DE PROPIEDAD Y LUGAR" : "PROPERTY & SITE REPORT", M, 10);
  y = 18;
  font(18, "bold", [255, 255, 255]); for (const l of titleL) { doc.text(l, M, y); y += lh(18); }
  font(10, "normal", [225, 240, 237]); for (const l of addrL) { doc.text(l, M, y); y += lh(10); }
  font(8, "normal", [207, 232, 228]); doc.text(pdfSafe(d.generated), M, y + 1);
  if (d.review) pill(W - M - 66, 11, d.review.label, d.review.tone, 66);
  y = bandH + 9;

  // ---- Key facts (values wrap; rows grow) ------------------------------------------------
  const colW = CW / 2 - 8;
  const rowsH: number[] = [];
  for (let r = 0; r < Math.ceil(d.facts.length / 2); r++) {
    const vs = d.facts.slice(r * 2, r * 2 + 2).map(([, v]) => wrap(v, colW, 10, "bold").length);
    rowsH.push(5 + Math.max(...vs) * lh(10) + 1.5);
  }
  const boxH = rowsH.reduce((a, b) => a + b, 0) + 4;
  ensure(boxH);
  color([250, 248, 243], "fill"); color(LINE, "draw");
  doc.roundedRect(M, y - 5, CW, boxH, 2.5, 2.5, "FD");
  let ry = y;
  d.facts.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    if (col === 0 && row > 0) ry += rowsH[row - 1]!;
    const x = M + 5 + col * (CW / 2);
    font(7.5, "bold", MUTED); doc.text(pdfSafe(k.toUpperCase()), x, ry + 1);
    font(10, "bold", INK); wrap(v, colW, 10, "bold").forEach((l, j) => doc.text(l, x, ry + 5.5 + j * lh(10)));
  });
  y += boxH;
  para(d.areaNote, 7.5, "italic", MUTED);

  // ---- Location validation --------------------------------------------------------------
  if (d.preliminary) para(d.preliminary, 9.5, "bold", TONE.attention.fg);
  for (const n of d.notices) para(n.text, 9.5, "normal", n.warn ? TONE.attention.fg : INK);
  y += 2;

  // ---- Conclusion (measured with its own font; splits if very long) ------------------------
  const concl = wrap(d.conclusion, CW - 10, 10.5);
  let i0 = 0;
  while (i0 < concl.length) {
    ensure(lh(10.5) + 6);
    const fit = Math.max(1, Math.min(concl.length - i0, Math.floor((BOTTOM - y - 4) / lh(10.5))));
    const h = fit * lh(10.5) + 5;
    color([243, 248, 247], "fill"); doc.roundedRect(M, y - 2, CW, h, 2, 2, "F");
    color(TEAL, "fill"); doc.rect(M, y - 2, 1.4, h, "F");
    font(10.5, "normal", INK);
    for (let k = 0; k < fit; k++) doc.text(concl[i0 + k]!, M + 5, y + 3 + k * lh(10.5));
    i0 += fit;
    y += h + 2;
  }

  // ---- Sections ------------------------------------------------------------------------------
  for (const s of d.sections) {
    const firstIsRow = !s.paragraphs.length && s.groups[0]?.layout === "rows";
    heading(s.title, firstIsRow ? 22 : 12);
    for (const p of s.paragraphs) para(p, /^(•|–|-|\s)/.test(p) ? 9 : 9.5, "normal", /^\s/.test(p) ? MUTED : INK, /^(•|–|\s)/.test(p) ? M + 3 : M, /^(•|–|\s)/.test(p) ? CW - 3 : CW);
    if (s.paragraphs.length && s.groups.length) y += 2;
    for (const g of s.groups) {
      if (g.label && g.tone) { ensure(16); y += pill(M, y, g.label, g.tone) + 2.5; }
      else if (g.label) { ensure(20); para(g.label, 11, "bold", TEAL); y += 1; }
      for (const it of g.items) g.layout === "rows" ? rowItem(it) : bullet(it);
      y += 1.5;
    }
  }
  ensure(lh(7.5) * 2);
  para(d.snapshot, 7.5, "normal", MUTED);

  // ---- Footer on every page (after layout → exact page count) ----------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    color(LINE, "draw"); doc.setLineWidth(0.3); doc.line(M, H - 12, W - M, H - 12);
    const num = `${i} / ${pages}`;
    font(7, "normal", MUTED);
    const nw = doc.getTextWidth(num) + 4;
    const disc = wrap(d.disclaimer, CW - nw, 7);
    disc.slice(0, 2).forEach((l, k) => doc.text(l, M, H - 8.5 + k * lh(7)));
    doc.text(num, W - M, H - 8.5, { align: "right" });
  }
  return doc;
}

export async function downloadPropertyReportPdf(report: PropertyReport, lang: Lang, review: ReturnType<typeof exportableReview>) {
  const { jsPDF } = await import("jspdf");
  const d = reportDocument(report, lang, review);
  renderReportPdf(d, new jsPDF({ unit: "mm", format: "letter" })).save(d.fileName);
}

/** Alias kept for callers that read PDF text back (siteCases/consistency.ts). */
export const pdfSafeText = pdfSafe;

/** Export file name — same for the PDF and the JSON download. */
export function propertyReportFileName(report: PropertyReport, ext: "pdf" | "json"): string {
  return `property-report-${(report.property.catastro.value ?? report.property.municipality).replace(/[^A-Za-z0-9-]+/g, "-")}.${ext}`;
}

/** Build the PDF (no download) from the shared document. */
export async function renderPropertyReportPdf(report: PropertyReport, lang: Lang, review: ReturnType<typeof exportableReview>): Promise<JsPDF> {
  const { jsPDF } = await import("jspdf");
  return renderReportPdf(reportDocument(report, lang, review), new jsPDF({ unit: "mm", format: "letter" }));
}
