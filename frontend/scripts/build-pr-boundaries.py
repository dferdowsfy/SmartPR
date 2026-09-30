#!/usr/bin/env python3
"""
Build SmartPR's bundled Puerto Rico boundary dataset (municipios + barrios).

Source (public domain, U.S. Census Bureau):
  - TIGER/Line 2024 County Subdivisions, Puerto Rico
    https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/tl_2024_72_cousub.zip
    In Puerto Rico, county subdivisions are barrios (incl. barrios-pueblo) and
    each carries its county (= municipio) FIPS code, so one layer yields both.
  - Cartographic Boundary 2024 counties (names only, for municipio names)
    https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip

Output: frontend/src/kb/geo/pr_boundaries_tiger2024.json
  Rings are Douglas-Peucker simplified (tolerance ~2 m) and stored as
  delta-encoded integers in 1e-5 degree units (~1.1 m). The runtime decoder is
  frontend/src/app/locations/boundaries.ts.

Usage:
  pip install pyshp
  curl -O <both zip URLs above>; unzip tl_2024_72_cousub.zip; unzip cb_2024_us_county_500k.zip '*.dbf'
  python3 frontend/scripts/build-pr-boundaries.py <dir with the unzipped files>
"""

import json
import math
import os
import sys

import shapefile  # pyshp

TOLERANCE_DEG = 0.000018  # ~2 m
SCALE = 100000  # 1e-5 degree integer units


def perpendicular_distance(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, tol):
    """Iterative Douglas-Peucker on a closed ring (endpoints preserved)."""
    if len(points) <= 4:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        best, index = 0.0, None
        for i in range(start + 1, end):
            d = perpendicular_distance(points[i], points[start], points[end])
            if d > best:
                best, index = d, i
        if index is not None and best > tol:
            keep[index] = True
            stack.append((start, index))
            stack.append((index, end))
    out = [p for p, k in zip(points, keep) if k]
    # A ring needs at least 4 points (3 distinct + closure).
    return out if len(out) >= 4 else points


def encode_ring(points):
    flat, px, py = [], 0, 0
    for x, y in points:
        ix, iy = round(x * SCALE), round(y * SCALE)
        flat.extend([ix - px, iy - py])
        px, py = ix, iy
    return flat


def main(src):
    counties = shapefile.Reader(os.path.join(src, "cb_2024_us_county_500k"))
    municipio = {r["COUNTYFP"]: r["NAME"] for r in counties.records() if r["STATEFP"] == "72"}
    assert len(municipio) == 78, len(municipio)

    reader = shapefile.Reader(os.path.join(src, "tl_2024_72_cousub"))
    features = []
    total_in = total_out = 0
    for shape_rec in reader.iterShapeRecords():
        rec, shape = shape_rec.record, shape_rec.shape
        parts = list(shape.parts) + [len(shape.points)]
        rings = []
        for i in range(len(parts) - 1):
            ring = shape.points[parts[i] : parts[i + 1]]
            total_in += len(ring)
            simplified = simplify(ring, TOLERANCE_DEG)
            total_out += len(simplified)
            rings.append(encode_ring(simplified))
        xs = [p[0] for p in shape.points]
        ys = [p[1] for p in shape.points]
        # FUNCSTAT F / LSAD 00 = "County subdivisions not defined" (water).
        defined = rec["FUNCSTAT"] != "F"
        features.append(
            {
                "g": rec["GEOID"],
                "b": rec["NAME"] if defined else None,
                "l": rec["LSAD"],
                "c": rec["COUNTYFP"],
                "bb": [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)],
                # Rings in shapefile order: outer rings clockwise, holes counter-clockwise;
                # the runtime uses even-odd containment so orientation is irrelevant.
                "r": rings,
            }
        )

    out = {
        "source": {
            "id": "census-tiger-2024-cousub-72",
            "name": "U.S. Census Bureau TIGER/Line 2024 — County Subdivisions (Puerto Rico municipios and barrios)",
            "publisher": "U.S. Census Bureau",
            "version": "TIGER2024",
            "url": "https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/tl_2024_72_cousub.zip",
            "license": "Public domain (U.S. Government work)",
            "simplification_m": 2,
            "encoding": "rings are delta-encoded integer pairs in 1e-5 degrees (lng, lat)",
        },
        "municipios": municipio,
        "features": features,
    }
    dest = os.path.join(os.path.dirname(__file__), "..", "src", "kb", "geo", "pr_boundaries_tiger2024.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(features)} features, {total_in} -> {total_out} points, {os.path.getsize(dest)} bytes -> {dest}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
