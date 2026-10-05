"""PDF layout + content check for Property & Site Report PDFs.
Usage: pdf_layout_check.py report.pdf expect.json
Fails on: text outside the printable width, text in the footer band (except the
footer), overlapping text lines, wrong page numbers, missing content, URL
without a link annotation. Renders every page to PNG next to the PDF."""
import json, re, sys
import pymupdf

pdf, exp = sys.argv[1], json.load(open(sys.argv[2]))
doc = pymupdf.open(pdf)
MM = 72 / 25.4
problems = []
n = doc.page_count
alltext = []
for i, page in enumerate(doc):
    W, H = page.rect.width, page.rect.height
    left, right = 16 * MM - 1, W - 16 * MM + 1
    foot = H - 12 * MM
    page.get_pixmap(dpi=60).save(f"{pdf[:-4]}.p{i + 1}.png")
    lines = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            txt = "".join(s["text"] for s in l["spans"]).strip()
            if not txt:
                continue
            x0, y0, x1, y1 = l["bbox"]
            lines.append((x0, y0, x1, y1, txt))
            if x0 < left or x1 > right:
                problems.append(f"p{i+1}: outside printable width x0={x0/MM:.1f}mm x1={x1/MM:.1f}mm: {txt[:60]!r}")
            in_footer = y1 > foot - 0.5
            if in_footer and not y0 > foot:
                problems.append(f"p{i+1}: text crosses the footer rule: {txt[:60]!r}")
            if y1 > H - 2 * MM:
                problems.append(f"p{i+1}: text past the page edge: {txt[:60]!r}")
    # Overlap between distinct lines (same page).
    for a in range(len(lines)):
        for b in range(a + 1, len(lines)):
            A, B = lines[a], lines[b]
            ox = min(A[2], B[2]) - max(A[0], B[0])
            oy = min(A[3], B[3]) - max(A[1], B[1])
            if ox > 1 and oy > 1.2:
                problems.append(f"p{i+1}: overlapping text {A[4][:40]!r} / {B[4][:40]!r}")
    nums = [t for *_, t in lines if re.fullmatch(r"\d+ / \d+", t)]
    if nums != [f"{i + 1} / {n}"]:
        problems.append(f"p{i+1}: page number {nums} != {i + 1} / {n}")
    alltext.append("".join(t for (x0, y0, x1, y1, t) in lines if y0 < foot))
    # Last-line orphan heading check: a heading (13pt teal) must not be the last text above the footer.
    body = [l for l in lines if l[3] < foot]
    if body:
        last = max(body, key=lambda l: l[3])
        spans = [s for b in page.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"] if s["text"].strip() and abs(s["bbox"][3] - last[3]) < 0.5]
        if any(abs(s["size"] - 13) < 0.2 for s in spans):
            problems.append(f"p{i+1}: orphaned heading at the bottom: {last[4][:50]!r}")

norm = lambda s: re.sub(r"\s+", "", s)
flat = norm("".join(alltext))
missing = [e for e in exp["expect"] if norm(e) and norm(e) not in flat]
for m in missing[:12]:
    problems.append(f"missing in PDF: {m[:90]!r}")
linked = {l.get("uri") for p in doc for l in p.get_links() if l.get("uri")}
for u in set(exp["urls"]):
    if u not in linked:
        problems.append(f"URL without link annotation: {u}")
if problems:
    print("\n".join(problems[:40]))
    sys.exit(1)
print(f"{n} pages, {len(exp['expect'])} content strings found, {len(linked)} links")
