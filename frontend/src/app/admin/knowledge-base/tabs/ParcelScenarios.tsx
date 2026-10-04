"use client";

// ============================================================================
// Admin QA — Parcel scenarios. Runs recorded parcels (live GIS answers saved
// as fixtures) against proposed activities using the CURRENT graph (live,
// draft or proposed mode), so editing a use_permission / site_rule node is
// reflected here immediately. Shows inputs, GIS findings, rules evaluated and
// triggered, sources, the compatibility determination, approvals, confidence,
// the reasoning path — and every gap in graph coverage, so missing knowledge
// becomes visible QA work instead of a generated guess.
// ============================================================================

import { useMemo, useState } from "react";
import { COLORS, Btn, Pill, inputStyle } from "../ui";
import type { GraphNodeDTO } from "../../../rk/types";
import casesJson from "../../../locations/fixtures/propertyReportCases.json";
import { restoreSiteLayers } from "../../../locations/layers";
import type { IntakeSite } from "../../../locations/intakeLocation";
import type { ParcelFindings } from "../../../locations/parcel";
import { analyzeLandUse, COMPATIBILITY_TEXT, parseProposedActivity, type LandUseAnalysis } from "../../../locations/landUse";
import { landUseGraphFromNodes, parcelFactsFor, scenarioPathsForActivity } from "../../../locations/landUseGraph";
import { reasoningGraphFromNodes } from "../../../reasoning/loadGraph";

type Case = { latitude: number; longitude: number; place: { municipio: { name: string; fips?: string }; barrio?: { name: string; geoid?: string } } | null; layers: unknown; parcel: unknown };
const CASES = (casesJson as unknown as { cases: Record<string, Case> }).cases;
const PARCELS: Array<{ id: string; label: string }> = [
  { id: "santurce", label: "Santurce, San Juan — 040-028-001-24 (CT · P, VE · X, coastal, APE-ZC)" },
  { id: "straightforward", label: "Caguas — 225-085-948-54 (R-I, Zone X)" },
  { id: "protected_rural", label: "Gurabo — 173-000-001-39 (R-G · A-B, SREP-E)" },
  { id: "multi_district_b", label: "Carolina — 041-087-017-17 (VIAL · CT-3, advisory AO)" },
].filter((p) => CASES[p.id]);
const ACTIVITIES = ["Build a 120-room hotel", "Construct a multifamily residential building with 40 apartments", "Open a restaurant in the existing building", "Professional offices in the existing building", "Construct a warehouse", "Install a utility-scale solar project"];

const TONE: Record<string, string> = { permitted: COLORS.green, conditional: COLORS.amber, discretionary: COLORS.amber, professional_review: COLORS.purple, insufficient: COLORS.faint, potentially_prohibited: COLORS.red };

function siteOf(c: Case): IntakeSite {
  return {
    latitude: c.latitude, longitude: c.longitude, coordinate_source: "MAP_PIN", formatted_address: null,
    municipality: { name: c.place?.municipio.name ?? "—", fips: c.place?.municipio.fips ?? null }, barrio: c.place?.barrio ? { name: c.place.barrio.name, geoid: c.place.barrio.geoid ?? null } : null,
    near_boundary: false, designations: [], boundary_source: null, location_id: null, confirmed_at: "2026-10-04T00:00:00Z",
    layers: restoreSiteLayers(c.layers, c.latitude, c.longitude),
  };
}

export function ParcelScenarios({ nodes }: { nodes: GraphNodeDTO[] }) {
  const [parcelId, setParcelId] = useState(PARCELS[0]?.id ?? "santurce");
  const [custom, setCustom] = useState("");
  const [selected, setSelected] = useState(ACTIVITIES[0]!);
  const graphs = useMemo(() => ({ lu: landUseGraphFromNodes(nodes), rg: reasoningGraphFromNodes(nodes) }), [nodes]);
  const c = CASES[parcelId]!;
  const site = useMemo(() => siteOf(c), [c]);
  const parcel = c.parcel as ParcelFindings;
  const facts = useMemo(() => parcelFactsFor(site, parcel), [site, parcel]);
  const run = (text: string): LandUseAnalysis => { const a = parseProposedActivity(text, graphs.lu.landUses); return analyzeLandUse(facts, a, graphs.lu, scenarioPathsForActivity(graphs.rg, a)); };
  const matrix = useMemo(() => ACTIVITIES.map((t) => ({ t, r: run(t) })), [graphs, facts]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useMemo(() => run(selected), [selected, graphs, facts]); // eslint-disable-line react-hooks/exhaustive-deps
  const gapCount = matrix.reduce((a, m) => a + m.r.coverageGaps.length, 0);

  const box: React.CSSProperties = { border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.panel, padding: 12 };
  const h: React.CSSProperties = { color: COLORS.text, fontWeight: 700, fontSize: 13, margin: "0 0 6px" };
  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="parcel-scenarios">
      <div style={box}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={parcelId} onChange={(e) => setParcelId(e.target.value)} style={{ ...inputStyle, maxWidth: 520 }} aria-label="Parcel" data-testid="scenario-parcel">
            {PARCELS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <Pill color={gapCount ? COLORS.amber : COLORS.green}>{gapCount} coverage gap(s) across {ACTIVITIES.length} activities</Pill>
        </div>
        <div style={{ color: COLORS.faint, fontSize: 11.5, marginTop: 6 }}>Recorded live GIS answers (fixture). Rules come from the graph currently loaded in this admin — edits apply immediately.</div>
      </div>

      <div style={box}>
        <p style={h}>Activities on this parcel</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }} data-testid="scenario-matrix">
          <thead><tr style={{ color: COLORS.faint, textAlign: "left" }}><th>Activity</th><th>Base zoning</th><th>Overall</th><th>Confidence</th><th>Approvals</th><th>Gaps</th></tr></thead>
          <tbody>
            {matrix.map(({ t, r }) => (
              <tr key={t} onClick={() => setSelected(t)} style={{ cursor: "pointer", background: t === selected ? COLORS.panel2 : undefined, borderTop: `1px solid ${COLORS.border}` }} data-testid="scenario-row" data-outcome={r.compatibility.outcome}>
                <td style={{ color: COLORS.text, padding: "6px 4px" }}>{t}</td>
                <td style={{ color: TONE[r.compatibility.baseOutcome ?? "insufficient"] }}>{r.compatibility.baseOutcome ? COMPATIBILITY_TEXT[r.compatibility.baseOutcome].en : "—"}</td>
                <td style={{ color: TONE[r.compatibility.outcome] }}>{COMPATIBILITY_TEXT[r.compatibility.outcome].en}</td>
                <td style={{ color: COLORS.dim }}>{r.compatibility.confidence}</td>
                <td style={{ color: COLORS.dim }}>{r.approvals.length}</td>
                <td style={{ color: r.coverageGaps.length ? COLORS.amber : COLORS.faint }}>{r.coverageGaps.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Try another activity…" style={{ ...inputStyle, flex: 1 }} data-testid="scenario-custom" />
          <Btn small onClick={() => custom.trim() && setSelected(custom.trim())}>Run</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }} data-testid="scenario-detail">
        <div style={box}>
          <p style={h}>Input parcel facts</p>
          <pre style={{ margin: 0, color: COLORS.dim, fontSize: 11.5, whiteSpace: "pre-wrap" }}>{JSON.stringify(facts, null, 1)}</pre>
          <p style={{ ...h, marginTop: 10 }}>GIS findings</p>
          <ul style={{ margin: 0, paddingLeft: 16, color: COLORS.dim, fontSize: 12 }}>
            <li>Zoning: {parcel.zoning.districts.map((d) => `${d.code}${d.share != null ? ` ${Math.round(d.share * 1000) / 10}%` : ""}`).join(" · ") || parcel.zoning.status}</li>
            <li>FEMA: {parcel.flood.zones.map((z) => `${z.zone}${z.share != null ? ` ${Math.round(z.share * 1000) / 10}%` : ""}`).join(" · ") || parcel.flood.status}</li>
            {Object.values(parcel.extras ?? {}).map((e) => e && <li key={e.id}>{e.id}: {e.status}{e.value ? ` — ${e.value}` : ""}</li>)}
          </ul>
        </div>
        <div style={box}>
          <p style={h}>Proposed activity → determination</p>
          <div style={{ color: COLORS.dim, fontSize: 12.5 }}>“{detail.activity.raw}” → <b style={{ color: COLORS.text }}>{detail.activity.useName ?? "not recognised"}</b> · construction: {detail.activity.construction ?? "unknown"}</div>
          <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, color: TONE[detail.compatibility.outcome] }} data-testid="scenario-outcome">{COMPATIBILITY_TEXT[detail.compatibility.outcome].en} <span style={{ color: COLORS.faint, fontSize: 12, fontWeight: 500 }}>confidence {detail.compatibility.confidence}</span></div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16, color: COLORS.dim, fontSize: 12 }}>{detail.compatibility.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <p style={{ ...h, marginTop: 10 }}>Reasoning path</p>
          <ol style={{ margin: 0, paddingLeft: 16, color: COLORS.dim, fontSize: 12 }}>{detail.compatibility.path.map((p, i) => <li key={i}><b>{p.kind}</b> {p.label}</li>)}</ol>
          <p style={{ ...h, marginTop: 10 }}>Requirements generated</p>
          <ul style={{ margin: 0, paddingLeft: 16, color: COLORS.dim, fontSize: 12 }}>{detail.approvals.map((a) => <li key={a.id}>{a.name} <i>({a.status})</i> — {a.sources.map((x) => x.name).join("; ") || "no source"}</li>)}</ul>
        </div>
        <div style={box}>
          <p style={h}>Rules evaluated ({detail.rulesEvaluated.length}) · triggered ({detail.rulesEvaluated.filter((r) => r.triggered).length})</p>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>{detail.rulesEvaluated.map((r) => <li key={r.id} style={{ color: r.triggered ? COLORS.text : COLORS.faint }}>{r.triggered ? "●" : "○"} {r.name} — {r.why}</li>)}</ul>
          <p style={{ ...h, marginTop: 10, color: detail.coverageGaps.length ? COLORS.amber : COLORS.text }}>Missing source / rule coverage ({detail.coverageGaps.length})</p>
          {detail.coverageGaps.length === 0 ? <div style={{ color: COLORS.faint, fontSize: 12 }}>None.</div> : (
            <ul style={{ margin: 0, paddingLeft: 16, color: "#fcd34d", fontSize: 12 }} data-testid="scenario-gaps">{detail.coverageGaps.map((g, i) => <li key={i}><b>{g.kind}</b>: {g.detail}</li>)}</ul>
          )}
          <p style={{ ...h, marginTop: 10 }}>Unresolved</p>
          <ul style={{ margin: 0, paddingLeft: 16, color: COLORS.dim, fontSize: 12 }}>{detail.unresolved.map((u, i) => <li key={i}>{u.kind}: {u.text}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
