"use client";

// ============================================================================
// Reasoning Paths — scenario-based permit reasoning, visualized and testable.
//
//   Scenario → Decision Conditions → Process Variant → Permit → Requirements → Evidence
//
// Read from the same graph nodes as every other tab (no separate store):
// mappings are scenario_mapping nodes, so creating, editing and
// activating/deactivating them goes through the normal node API + DetailPanel.
// ============================================================================

import { useMemo, useState } from "react";
import { COLORS, Btn, Pill, StatusBadge, inputStyle, labelStyle, selectStyle } from "../ui";
import { NODE_TYPE_CONFIGS, REASONING_FACT_KEYS } from "../../../rk/registry";
import type { GraphNodeDTO, NodeType } from "../../../rk/types";
import type { GraphData } from "../graph/useGraphData";
import { DetailPanel } from "../graph/DetailPanel";
import { RequirementsTab } from "./RequirementsTab";
import { reasoningGraphFromNodes } from "../../../reasoning/loadGraph";
import { describeClause, reason, runMappingTests, type Clause, type Facts, type ReasoningPath } from "../../../reasoning/scenarioReasoning";
import { checkGraphQuality, type QualityIssue } from "../../../reasoning/graphQuality";

const REASONING_TYPES: NodeType[] = ["scenario", "decision_condition", "process_variant", "scenario_mapping", "document", "evidence_type", "regulatory_source", "agency", "business_type", "municipality"];
const MANAGE_TYPES: NodeType[] = ["scenario_mapping", "scenario", "decision_condition", "process_variant"];

const PRESETS: { label: string; facts: Facts }[] = [
  { label: "New restaurant, existing local, no work (Guaynabo)", facts: { project_intent: "new_business", existing_premises: true, construction_required: false, ownership_changed: false, home_based: false, residential: false, municipality: "Guaynabo", business_type: "Restaurant" } },
  { label: "New business + remodel", facts: { project_intent: "new_business", existing_premises: true, construction_required: true, home_based: false, residential: false } },
  { label: "Buy an existing business (same use)", facts: { project_intent: "existing_business", existing_business: true, ownership_changed: true, same_use: true, new_use_requested: false } },
  { label: "Change of use", facts: { project_intent: "existing_business", existing_business: true, new_use_requested: true, same_use: false } },
  { label: "Home-based business", facts: { project_intent: "new_business", home_based: true } },
  { label: "Renew permit", facts: { existing_business: true, renewal_due: true } },
];

const str = (v: unknown) => (v == null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const SEV_COLOR = { error: COLORS.red, warning: COLORS.amber, info: COLORS.faint } as const;
const STATUS_COLOR = { applies: COLORS.green, needs_facts: COLORS.amber, not_applicable: COLORS.faint } as const;

type View = "paths" | "test" | "quality" | "manage";

export function ReasoningTab({ graph, onSaved }: { graph: GraphData; onSaved: (msg: string) => void }) {
  const [view, setView] = useState<View>("paths");
  const [inspected, setInspected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const nodes = useMemo(() => graph.graph?.nodes ?? [], [graph.graph]);
  const rg = useMemo(() => reasoningGraphFromNodes(nodes), [nodes]);
  const quality = useMemo(() => checkGraphQuality(rg), [rg]);
  const issuesBy = useMemo(() => {
    const m = new Map<string, QualityIssue[]>();
    for (const i of quality) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i]);
    return m;
  }, [quality]);

  if (!graph.graph) return <div style={{ color: COLORS.faint, padding: 40 }}>Loading graph…</div>;
  const views: [View, string][] = [["paths", "Reasoning paths"], ["test", "Test reasoning"], ["quality", `Graph quality (${quality.filter((q) => q.severity !== "info").length})`], ["manage", "Manage mappings"]];

  return (
    <div data-testid="reasoning-tab">
      <div style={{ marginBottom: 12, padding: 12, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.panel, color: COLORS.dim, fontSize: 12.5, lineHeight: 1.55 }}>
        <b style={{ color: COLORS.text }}>Project → Scenario → Decision conditions → Process variant → Permit → Requirements → Evidence.</b>{" "}
        The graph decides <i>what</i> applies; Clara only executes <i>how</i>. Permits keep owning their requirements — mappings never copy them.
        Several paths can apply at once (e.g. Permiso Único + PCOC).
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {views.map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`kb-tab ${view === id ? "active" : ""}`} data-testid={`reasoning-view-${id}`}>{label}</button>
        ))}
      </div>

      {view === "manage" ? (
        <RequirementsTab graph={graph} onSaved={onSaved} initialType="scenario_mapping" allowedTypes={MANAGE_TYPES} />
      ) : (
        <div className={inspected || editing ? "kb-split detail" : undefined}>
          <div>
            {view === "paths" && <PathsView nodes={nodes} rg={rg} issuesBy={issuesBy} onInspect={setInspected} />}
            {view === "test" && <TestView rg={rg} nodes={nodes} onInspect={setInspected} />}
            {view === "quality" && <QualityView issues={quality} onInspect={setInspected} byEntity={graph.byEntity} />}
          </div>
          {editing ? (
            <DetailPanel entityId={editing} graph={graph} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); onSaved(m); }} />
          ) : inspected ? (
            <Inspector id={inspected} graph={graph} rg={rg} issues={issuesBy.get(inspected) ?? []} onInspect={setInspected} onClose={() => setInspected(null)} onEdit={() => setEditing(inspected)} onSaved={onSaved} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paths: every scenario with its branches, filtered and searchable.
// ---------------------------------------------------------------------------

function PathsView({ nodes, rg, issuesBy, onInspect }: { nodes: GraphNodeDTO[]; rg: ReturnType<typeof reasoningGraphFromNodes>; issuesBy: Map<string, QualityIssue[]>; onInspect: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState({ scenario: "", variant: "", permit: "", agency: "", source: "", status: "all", nodeType: "" });
  const byId = useMemo(() => new Map(nodes.map((n) => [n.entityId, n])), [nodes]);
  const name = (id: string) => byId.get(id)?.label || str(byId.get(id)?.data.name) || id;
  const statusOf = (m: Record<string, unknown> & { id: string }) => (m.mapping_status === "inactive" || ["archived", "superseded", "rolled_back"].includes(str(rg.nodeStatus?.[m.id])) ? "inactive" : "active");
  const variant = (id: string) => rg.variants.find((v) => v.id === id);

  const needle = q.trim().toLowerCase();
  const scenarios = rg.scenarios.filter((s) => {
    if (f.scenario && s.id !== f.scenario) return false;
    if (!needle) return true;
    return [s.name, s.code, s.aliases, s.description].map(str).join(" ").toLowerCase().replace(/_/g, " ").includes(needle);
  });
  const mappingPasses = (m: Record<string, unknown> & { id: string }) => {
    const v = variant(str(m.process_variant_id));
    if (f.variant && str(m.process_variant_id) !== f.variant) return false;
    if (f.permit && str(v?.permit_document_id) !== f.permit) return false;
    if (f.agency && str(v?.agency_id) !== f.agency) return false;
    if (f.source && !arr(m.source_ids).includes(f.source) && !arr(v?.source_ids).includes(f.source)) return false;
    if (f.status !== "all" && statusOf(m) !== f.status) return false;
    if (f.nodeType) {
      const ids = [str(m.scenario_id), ...arr(m.condition_ids), str(m.process_variant_id), str(v?.permit_document_id), ...arr(m.source_ids)];
      if (!ids.some((id) => byId.get(id)?.nodeType === f.nodeType)) return false;
    }
    return true;
  };
  const filtered = Object.entries(f).some(([k, v]) => v && !(k === "status" && v === "all"));
  const opts = (list: { id: string; label: string }[]) => list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>);
  const permits = [...new Set(rg.variants.map((v) => str(v.permit_document_id)).filter(Boolean))];
  const agencies = [...new Set(rg.variants.map((v) => str(v.agency_id)).filter(Boolean))];
  const sources = [...new Set([...rg.mappings, ...rg.variants].flatMap((m) => arr(m.source_ids)))];
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8, marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search scenarios — "start business", "remodel", "renew"…' style={{ ...inputStyle, gridColumn: "1 / -1" }} data-testid="reasoning-search" />
        <select style={selectStyle} value={f.scenario} onChange={set("scenario")} aria-label="Scenario"><option value="">All scenarios</option>{opts(rg.scenarios.map((s) => ({ id: s.id, label: str(s.name) })))}</select>
        <select style={selectStyle} value={f.variant} onChange={set("variant")} aria-label="Process variant"><option value="">All process variants</option>{opts(rg.variants.map((v) => ({ id: v.id, label: str(v.name) })))}</select>
        <select style={selectStyle} value={f.permit} onChange={set("permit")} aria-label="Permit"><option value="">All permits</option>{opts(permits.map((id) => ({ id, label: name(id) })))}</select>
        <select style={selectStyle} value={f.agency} onChange={set("agency")} aria-label="Agency"><option value="">All agencies</option>{opts(agencies.map((id) => ({ id, label: name(id) })))}</select>
        <select style={selectStyle} value={f.source} onChange={set("source")} aria-label="Source"><option value="">All sources</option>{opts(sources.map((id) => ({ id, label: name(id) })))}</select>
        <select style={selectStyle} value={f.nodeType} onChange={set("nodeType")} aria-label="Node type"><option value="">Any node type</option>{opts(REASONING_TYPES.map((t) => ({ id: t, label: NODE_TYPE_CONFIGS[t].label })))}</select>
        <select style={selectStyle} value={f.status} onChange={set("status")} aria-label="Status"><option value="all">Active + inactive</option><option value="active">Active only</option><option value="inactive">Inactive only</option></select>
      </div>
      <div style={{ color: COLORS.faint, fontSize: 11.5, marginBottom: 10 }}>Business type and municipality are facts, not branches — set them in <b>Test reasoning</b> to see which paths a project would take.</div>

      {scenarios.length === 0 && <div style={{ color: COLORS.faint, padding: 20 }}>No scenarios match “{q}”.</div>}
      <div style={{ display: "grid", gap: 12 }}>
        {scenarios.map((s) => {
          const ms = rg.mappings.filter((m) => str(m.scenario_id) === s.id && mappingPasses(m));
          if (filtered && !ms.length) return null;
          return (
            <div key={s.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.panel, padding: 12 }} data-testid="reasoning-scenario" data-scenario={str(s.code)}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <NodeChip id={s.id} type="scenario" label={str(s.name)} onInspect={onInspect} />
                <span style={{ color: COLORS.faint, fontSize: 11.5 }}>{str(s.code)} · detected when {(Array.isArray(s.detect_when) ? (s.detect_when as Clause[]) : []).map(describeClause).join(" OR ") || "explicitly selected"}</span>
                <IssueDots issues={issuesBy.get(s.id)} />
              </div>
              {ms.length === 0 && <div style={{ color: COLORS.amber, fontSize: 12, marginTop: 8 }}>No mapping — this scenario does not lead to any process yet.</div>}
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {ms.map((m) => {
                  const v = variant(str(m.process_variant_id));
                  const permit = str(v?.permit_document_id);
                  const inactive = statusOf(m) === "inactive";
                  return (
                    <div key={m.id} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", paddingLeft: 14, borderLeft: `2px solid ${inactive ? COLORS.faint : COLORS.accent}`, opacity: inactive ? 0.55 : 1 }} data-testid="reasoning-branch" data-mapping={m.id}>
                      <NodeChip id={m.id} type="scenario_mapping" label={inactive ? "inactive mapping" : "when"} onInspect={onInspect} />
                      {arr(m.condition_ids).length === 0 && <span style={{ color: COLORS.faint, fontSize: 12 }}>always</span>}
                      {arr(m.condition_ids).map((c, i) => (
                        <span key={c} style={{ display: "contents" }}>{i > 0 && <span style={{ color: COLORS.faint, fontSize: 11 }}>AND</span>}<NodeChip id={c} type="decision_condition" label={name(c)} onInspect={onInspect} /></span>
                      ))}
                      <Arrow />
                      {v ? <NodeChip id={v.id} type="process_variant" label={str(v.name)} onInspect={onInspect} /> : <span style={{ color: COLORS.red, fontSize: 12 }}>missing variant</span>}
                      <Arrow />
                      {permit ? <NodeChip id={permit} type="document" label={name(permit)} onInspect={onInspect} /> : <span style={{ color: COLORS.red, fontSize: 12 }}>no permit linked</span>}
                      <IssueDots issues={[...(issuesBy.get(m.id) ?? []), ...(v ? issuesBy.get(v.id) ?? [] : [])]} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test reasoning: facts in → scenarios, conditions, variants, permits, why.
// ---------------------------------------------------------------------------

function TestView({ rg, nodes, onInspect }: { rg: ReturnType<typeof reasoningGraphFromNodes>; nodes: GraphNodeDTO[]; onInspect: (id: string) => void }) {
  const [facts, setFacts] = useState<Facts>(PRESETS[0].facts);
  const result = useMemo(() => reason(rg, facts), [rg, facts]);
  const businessTypes = nodes.filter((n) => n.nodeType === "business_type").map((n) => str(n.data.name) || n.label).sort();
  const municipalities = nodes.filter((n) => n.nodeType === "municipality").map((n) => str(n.data.name) || n.label).sort();
  const setFact = (k: string, raw: string) => {
    const next = { ...facts };
    if (raw === "") delete next[k];
    else next[k] = raw === "true" ? true : raw === "false" ? false : raw;
    setFacts(next);
  };
  const boolKeys = REASONING_FACT_KEYS.filter((k) => !["project_intent", "business_type", "municipality"].includes(k));
  const show = (v: unknown) => (v === undefined ? "" : String(v));
  const applying = result.paths.filter((p) => p.status === "applies");
  const pending = result.paths.filter((p) => p.status === "needs_facts");
  const notApplying = result.paths.filter((p) => p.status === "not_applicable");

  return (
    <div style={{ display: "grid", gap: 14 }} data-testid="reasoning-test">
      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.panel, padding: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {PRESETS.map((p) => <Btn key={p.label} small onClick={() => setFacts(p.facts)}>{p.label}</Btn>)}
          <Btn small onClick={() => setFacts({})}>Clear</Btn>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
          <label style={labelStyle}>project intent
            <select style={selectStyle} value={show(facts.project_intent)} onChange={(e) => setFact("project_intent", e.target.value)} data-testid="fact-project_intent">
              <option value="">unknown</option><option value="new_business">new business</option><option value="existing_business">existing business</option><option value="project_only">project only</option>
            </select>
          </label>
          <label style={labelStyle}>business type
            <select style={selectStyle} value={show(facts.business_type)} onChange={(e) => setFact("business_type", e.target.value)}>
              <option value="">unknown</option>{[...new Set([show(facts.business_type), ...businessTypes].filter(Boolean))].map((b) => <option key={b}>{b}</option>)}
            </select>
          </label>
          <label style={labelStyle}>municipality
            <select style={selectStyle} value={show(facts.municipality)} onChange={(e) => setFact("municipality", e.target.value)}>
              <option value="">unknown</option>{[...new Set([show(facts.municipality), ...municipalities].filter(Boolean))].map((b) => <option key={b}>{b}</option>)}
            </select>
          </label>
          {boolKeys.map((k) => (
            <label key={k} style={labelStyle}>{k.replace(/_/g, " ")}
              <select style={selectStyle} value={show(facts[k])} onChange={(e) => setFact(k, e.target.value)} data-testid={`fact-${k}`}>
                <option value="">unknown</option><option value="true">yes</option><option value="false">no</option>
              </select>
            </label>
          ))}
        </div>
      </div>

      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.panel, padding: 12 }}>
        <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Detected scenarios</div>
        {result.scenarios.length === 0 ? <div style={{ color: COLORS.faint, fontSize: 12.5 }}>None yet — answer more facts.</div> : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="detected-scenarios">
            {result.scenarios.map((s) => <span key={s.id} title={s.detectedBy.join("; ")}><NodeChip id={s.id} type="scenario" label={s.name} onInspect={onInspect} /></span>)}
          </div>
        )}
        <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 13, margin: "12px 0 6px" }}>Applicable process variants &amp; permits</div>
        {result.applicableVariants.length === 0 ? <div style={{ color: COLORS.faint, fontSize: 12.5 }}>None determined.</div> : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="applicable-variants">
            {result.applicableVariants.map((v) => <span key={v.id}><NodeChip id={v.id} type="process_variant" label={`${v.name} (via ${v.viaScenarios.join(", ")})`} onInspect={onInspect} /></span>)}
          </div>
        )}
      </div>

      {[...applying, ...pending, ...notApplying].map((p) => <PathCard key={p.mappingId} p={p} onInspect={onInspect} />)}
    </div>
  );
}

function PathCard({ p, onInspect }: { p: ReasoningPath; onInspect: (id: string) => void }) {
  const color = STATUS_COLOR[p.status];
  return (
    <div style={{ border: `1px solid ${color}55`, borderLeft: `3px solid ${color}`, borderRadius: 10, background: COLORS.panel, padding: 12, opacity: p.status === "not_applicable" ? 0.7 : 1 }} data-testid="reasoning-path" data-status={p.status} data-mapping={p.mappingId}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Pill color={color}>{p.status === "applies" ? "Applies" : p.status === "needs_facts" ? "Needs facts" : "Does not apply"}</Pill>
        <NodeChip id={p.scenario.id} type="scenario" label={p.scenario.name} onInspect={onInspect} />
        <Arrow />
        {p.variant && <NodeChip id={p.variant.id} type="process_variant" label={p.variant.name} onInspect={onInspect} />}
        {p.permit && (<><Arrow /><NodeChip id={p.permit.id} type="document" label={p.permit.name} onInspect={onInspect} /></>)}
        <button onClick={() => onInspect(p.mappingId)} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.accent, fontSize: 12, cursor: "pointer" }}>{p.mappingId}</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {p.conditions.map((c) => (
          <span key={c.id} style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 999, border: `1px solid ${c.state === "met" ? COLORS.green : c.state === "unmet" ? COLORS.red : COLORS.amber}66`, color: COLORS.dim }}>
            {c.state === "met" ? "✓" : c.state === "unmet" ? "✗" : "?"} {c.name}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: COLORS.panel2, fontSize: 12.5, color: COLORS.dim, lineHeight: 1.6 }} data-testid="reasoning-why">
        <div style={{ color: COLORS.text, fontWeight: 700, marginBottom: 2 }}>Why did SmartPR determine this?</div>
        {p.why.map((w, i) => <div key={i} style={i === 0 ? { color: COLORS.text } : { paddingLeft: 10 }}>{i === 0 ? w : `• ${w}`}</div>)}
        <div style={{ color: COLORS.faint, fontSize: 11.5, marginTop: 6 }}>
          Effective {p.provenance.effectiveDate || "—"} · version {p.provenance.version || "—"} · last verified {p.provenance.lastVerifiedAt || "—"}
        </div>
        {p.sources.map((s) => (
          <div key={s.id} style={{ fontSize: 11.5 }}>
            {s.authority === "discovery_only" ? "🔎 discovery only (not legal authority): " : "📜 "}
            {s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: COLORS.accent }}>{s.name}</a> : s.name}
            {s.citation ? ` — ${s.citation}` : ""}
          </div>
        ))}
      </div>
      {p.status === "applies" && (p.requirements.length > 0 || p.evidence.length > 0) && (
        <div style={{ marginTop: 8, fontSize: 12, color: COLORS.dim }}>
          {p.requirements.length > 0 && <div><b style={{ color: COLORS.text }}>Requirements (owned by the permit):</b> {p.requirements.map((r) => r.name).join(" · ")}</div>}
          {p.evidence.length > 0 && <div><b style={{ color: COLORS.text }}>Evidence:</b> {p.evidence.map((e) => e.name).join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quality warnings.
// ---------------------------------------------------------------------------

function QualityView({ issues, onInspect, byEntity }: { issues: QualityIssue[]; onInspect: (id: string) => void; byEntity: Map<string, GraphNodeDTO> }) {
  const [sev, setSev] = useState<"all" | QualityIssue["severity"]>("all");
  const list = issues.filter((i) => sev === "all" || i.severity === sev);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return (
    <div data-testid="reasoning-quality">
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {(["all", "error", "warning", "info"] as const).map((s) => (
          <Btn key={s} small primary={sev === s} onClick={() => setSev(s)}>{s === "all" ? `All (${issues.length})` : `${s} (${counts[s]})`}</Btn>
        ))}
      </div>
      {list.length === 0 && <div style={{ color: COLORS.green, fontSize: 13 }}>No issues.</div>}
      <div style={{ display: "grid", gap: 6 }}>
        {list.map((i, k) => (
          <button key={k} onClick={() => onInspect(i.nodeId)} style={{ textAlign: "left", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderLeft: `3px solid ${SEV_COLOR[i.severity]}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: COLORS.dim, fontSize: 12.5 }} data-testid="quality-issue" data-code={i.code}>
            <span style={{ color: SEV_COLOR[i.severity], fontWeight: 700, textTransform: "uppercase", fontSize: 10.5, marginRight: 8 }}>{i.code.replace(/_/g, " ")}</span>
            {i.message}
            <span style={{ color: COLORS.faint, marginLeft: 6 }}>{byEntity.get(i.nodeId)?.nodeType ? `· ${NODE_TYPE_CONFIGS[byEntity.get(i.nodeId)!.nodeType].label}` : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector: relationships, provenance, status, test cases.
// ---------------------------------------------------------------------------

function Inspector({ id, graph, rg, issues, onInspect, onClose, onEdit, onSaved }: {
  id: string; graph: GraphData; rg: ReturnType<typeof reasoningGraphFromNodes>; issues: QualityIssue[];
  onInspect: (id: string) => void; onClose: () => void; onEdit: () => void; onSaved: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = graph.byEntity.get(id);
  const edges = graph.graph?.edges ?? [];
  const outgoing = edges.filter((e) => e.fromEntity === id);
  const incoming = edges.filter((e) => e.toEntity === id);
  const label = (eid: string) => graph.byEntity.get(eid)?.label || eid;
  if (!n) return <div style={{ color: COLORS.faint, padding: 16 }}>{id} is not in the graph. <Btn small onClick={onClose}>Close</Btn></div>;
  const d = n.data;
  const isMapping = n.nodeType === "scenario_mapping";
  const tests = isMapping ? runMappingTests(rg, id) : [];
  const triggeredBy = rg.mappings.filter((m) => [str(m.scenario_id), str(m.process_variant_id), ...arr(m.condition_ids)].includes(id));
  const sources = arr(d.source_ids);

  const toggle = async () => {
    setBusy(true); setErr(null);
    try {
      const next = str(d.mapping_status) === "inactive" ? "active" : "inactive";
      const res = await fetch(`/api/rk/nodes/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { ...d, mapping_status: next }, note: `Mapping ${next === "active" ? "activated" : "deactivated"} from Reasoning Paths` }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(str((body as { error?: string }).error) || `HTTP ${res.status}`);
      onSaved(`${id} ${next === "active" ? "activated" : "deactivated"}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, fontSize: 12.5, padding: "3px 0" }}><span style={{ color: COLORS.faint }}>{k}</span><span style={{ color: COLORS.dim, wordBreak: "break-word" }}>{v || "—"}</span></div>
  );
  return (
    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.panel, padding: 14, alignSelf: "start", position: "sticky", top: 12 }} data-testid="reasoning-inspector">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ color: NODE_TYPE_CONFIGS[n.nodeType].color, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{NODE_TYPE_CONFIGS[n.nodeType].label}</div>
          <div style={{ color: COLORS.text, fontWeight: 750, fontSize: 15 }}>{n.label}</div>
          <div style={{ color: COLORS.faint, fontSize: 11.5 }}>{id}</div>
        </div>
        <span role="button" onClick={onClose} style={{ cursor: "pointer", color: COLORS.faint }}>✕</span>
      </div>
      <div style={{ marginTop: 10 }}>
        {row("Status", <span style={{ display: "inline-flex", gap: 6 }}><StatusBadge status={n.status} />{isMapping && <Pill color={str(d.mapping_status) === "inactive" ? COLORS.faint : COLORS.green}>{str(d.mapping_status) || "active"}</Pill>}</span>)}
        {row("Citation", [str(d.citation), str(d.citation_section)].filter(Boolean).join(" — ") || sources.map(label).join(", "))}
        {row("Effective", str(d.effective_date))}
        {row("Version", str(d.version || d.source_version) || String(n.version))}
        {row("Last verified", str(d.last_verified_at))}
        {str(d.url) && row("URL", <a href={str(d.url)} target="_blank" rel="noreferrer" style={{ color: COLORS.accent }}>{str(d.url)}</a>)}
        {str(d.authority_level) === "discovery_only" && row("Authority", <span style={{ color: COLORS.amber }}>Discovery only — not legal authority</span>)}
      </div>
      {issues.length > 0 && <div style={{ marginTop: 8 }}>{issues.map((i, k) => <div key={k} style={{ fontSize: 12, color: SEV_COLOR[i.severity] }}>⚠ {i.message}</div>)}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <Btn small primary disabled={!graph.enabled} onClick={onEdit}>Edit</Btn>
        {isMapping && <Btn small disabled={!graph.enabled || busy} onClick={toggle}>{str(d.mapping_status) === "inactive" ? "Activate" : "Deactivate"}</Btn>}
        {!graph.enabled && <span style={{ color: COLORS.faint, fontSize: 11.5, alignSelf: "center" }}>Read-only (no database)</span>}
      </div>
      {err && <div style={{ color: COLORS.red, fontSize: 12, marginTop: 6 }}>{err}</div>}
      <RelList title={`Outgoing (${outgoing.length})`} items={outgoing.map((e) => ({ id: e.toEntity, rel: e.edgeType, label: label(e.toEntity) }))} onInspect={onInspect} />
      <RelList title={`Incoming (${incoming.length})`} items={incoming.map((e) => ({ id: e.fromEntity, rel: e.edgeType, label: label(e.fromEntity) }))} onInspect={onInspect} />
      {!isMapping && triggeredBy.length > 0 && <RelList title={`Used by mappings (${triggeredBy.length})`} items={triggeredBy.map((m) => ({ id: m.id, rel: str(m.mapping_status) || "active", label: str(m.name) || m.id }))} onInspect={onInspect} />}
      {isMapping && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>Test cases that trigger this mapping</div>
          {tests.length === 0 ? <div style={{ color: COLORS.faint, fontSize: 12 }}>None — add test_cases to this mapping.</div> : tests.map((t, k) => (
            <div key={k} style={{ fontSize: 12, color: t.pass ? COLORS.green : COLORS.red }} data-testid="mapping-test" data-pass={t.pass}>
              {t.pass ? "✓" : "✗"} {t.name || `case ${k + 1}`} <span style={{ color: COLORS.faint }}>— expected {t.expect ? "applies" : "does not apply"}, got {t.applied ? "applies" : "does not apply"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RelList({ title, items, onInspect }: { title: string; items: { id: string; rel: string; label: string }[]; onInspect: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>{title}</div>
      {items.map((i, k) => (
        <div key={k} style={{ fontSize: 12, display: "flex", gap: 6 }}>
          <span style={{ color: COLORS.faint, minWidth: 90 }}>{i.rel.replace(/_/g, " ")}</span>
          <button onClick={() => onInspect(i.id)} style={{ background: "none", border: "none", padding: 0, color: COLORS.accent, cursor: "pointer", textAlign: "left", fontSize: 12 }}>{i.label}</button>
        </div>
      ))}
    </div>
  );
}

function NodeChip({ id, type, label, onInspect }: { id: string; type: NodeType; label: string; onInspect: (id: string) => void }) {
  const c = NODE_TYPE_CONFIGS[type].color;
  return (
    <button onClick={() => onInspect(id)} title={`${NODE_TYPE_CONFIGS[type].label}: ${id}`} style={{ border: `1px solid ${c}66`, background: c + "1a", color: COLORS.text, borderRadius: 999, padding: "3px 10px", fontSize: 12, cursor: "pointer" }} data-node={id}>
      {label}
    </button>
  );
}

const Arrow = () => <span style={{ color: COLORS.faint }}>→</span>;

function IssueDots({ issues }: { issues?: QualityIssue[] }) {
  const list = (issues ?? []).filter((i) => i.severity !== "info");
  if (!list.length) return null;
  const worst = list.some((i) => i.severity === "error") ? "error" : "warning";
  return <span title={list.map((i) => i.message).join("\n")} style={{ color: SEV_COLOR[worst], fontSize: 12 }}>⚠ {list.length}</span>;
}
