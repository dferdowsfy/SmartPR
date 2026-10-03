"use client";

// ============================================================================
// Reasoning Paths tab — QA surface for the Knowledge Graph Reasoning Paths
// layer (docs/reasoning-paths-design.md).
//
// Sections:
//   1. Scenarios  — read-only browser over seeded scenarios/conditions/variants
//   2. Ad-hoc test — fact editor (v1 catalog) + Run -> triggered/negative paths
//   3. Golden suite — run all tests/reasoning-paths/golden/*.json fixtures
//   4. Graph health — validateReasoningGraph() findings
//
// All data comes from the API route (/api/admin/reasoning-paths/run); this tab
// invents no scenario content. The evaluator/seed/validator are owned
// separately — until they land, the route returns 503/500 and this tab shows
// the error state (see src/lib/reasoning-paths/index.ts).
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Btn, Card, COLORS, Pill, SectionTitle, inputStyle, labelStyle, selectStyle } from "../ui";
import type {
  FactBag,
  NegativePath,
  ReasoningPathResult,
  TriggeredPath,
  ValidationFinding,
} from "../../../../lib/reasoning-paths";

// ---------------------------------------------------------------------------
// API payload shapes (mirrors src/app/api/admin/reasoning-paths/run/route.ts).
// ---------------------------------------------------------------------------

interface ScenarioSummary {
  id: string;
  label: string;
  description: string;
  requiredConditions: string[];
  excludedConditions: string[];
}

interface ConditionSummary {
  id: string;
  label: string;
  triggerSummary: string;
  sourceId: string;
  locator: string;
  confidence: string | null;
}

interface VariantSummary {
  id: string;
  label: string;
  processId: string;
  selectorConditions: string[];
  ruleIds: string[];
  active: boolean;
  supersededBy: string | null;
  note: string | null;
}

interface GraphSummary {
  scenarios: ScenarioSummary[];
  conditions: ConditionSummary[];
  variants: VariantSummary[];
}

interface SuiteEntry {
  id: string;
  name: string;
  pass: boolean;
  diffs: string[];
}

// ---------------------------------------------------------------------------
// v1 fact catalog (design §3). Booleans get checkboxes; the rest get
// text/number/select inputs.
// ---------------------------------------------------------------------------

const BOOLEAN_FACTS: { key: string; label: string }[] = [
  { key: "new_business", label: "New business" },
  { key: "existing_business", label: "Existing business" },
  { key: "existing_location", label: "Existing location" },
  { key: "construction_required", label: "Construction required" },
  { key: "remodeling", label: "Remodeling" },
  { key: "ownership_changed", label: "Ownership changed" },
  { key: "use_changed", label: "Use changed" },
  { key: "same_use", label: "Same use" },
  { key: "permit_renewal", label: "Permit renewal" },
  { key: "residential_use", label: "Residential use" },
  { key: "commercial_use", label: "Commercial use" },
  { key: "utility_connection", label: "Utility connection" },
  { key: "subdivision", label: "Subdivision" },
  { key: "controlled_substances", label: "Controlled substances" },
  { key: "food_service", label: "Food service" },
  { key: "grid_interconnection", label: "Grid interconnection" },
];

const UTILITY_TYPES = ["", "electric", "water", "both"];
const BUSINESS_ACTIVITIES = ["", "restaurant", "daycare", "pharmacy", "solar", "manufacturing", "retail", "office"];

// ---------------------------------------------------------------------------
// Small building blocks.
// ---------------------------------------------------------------------------

function Collapsible({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, marginBottom: 8, background: COLORS.panel2 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none",
          color: COLORS.text, fontSize: 13, fontWeight: 600, padding: "10px 14px", cursor: "pointer",
        }}
      >
        {open ? "▾" : "▸"} {title}
        {count !== undefined && <span style={{ color: COLORS.faint, fontWeight: 400 }}> ({count})</span>}
      </button>
      {open && <div style={{ padding: "4px 14px 14px", borderTop: `1px solid ${COLORS.border}` }}>{children}</div>}
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={{ background: COLORS.red + "15", border: `1px solid ${COLORS.red}55`, color: "#fca5a5", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
      {msg}
      <div style={{ color: COLORS.faint, fontSize: 12, marginTop: 4 }}>
        If the evaluator/seed has not been implemented yet, this is expected — see the stub note in src/lib/reasoning-paths/index.ts.
      </div>
    </div>
  );
}

function ConditionRef({ cond }: { cond: ConditionSummary | undefined }) {
  if (!cond) {
    return <span style={{ color: COLORS.red, fontSize: 12 }}>⚠ referenced condition missing from seed</span>;
  }
  return (
    <div style={{ fontSize: 12.5, marginBottom: 6 }}>
      <span style={{ color: COLORS.text, fontWeight: 600 }}>{cond.id}</span>
      <span style={{ color: COLORS.faint }}> — {cond.label}</span>
      <div style={{ color: COLORS.dim, marginTop: 2 }}>“{cond.triggerSummary}”</div>
      <div style={{ color: COLORS.faint, fontSize: 11.5, marginTop: 2 }}>
        {cond.sourceId} · {cond.locator}
        {cond.confidence && cond.confidence !== "high" && (
          <span style={{ color: COLORS.amber }}> · confidence: {cond.confidence}</span>
        )}
      </div>
    </div>
  );
}

function PathCard({ path }: { path: TriggeredPath }) {
  return (
    <Card accent={COLORS.green}>
      <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 4 }}>
        {path.scenarioLabel} <span style={{ color: COLORS.faint }}>→</span> {path.variantLabel}
      </div>
      <div style={{ fontSize: 11.5, color: COLORS.faint, marginBottom: 10 }}>
        {path.scenarioId} · {path.variantId} · process {path.processId}
      </div>
      <div style={{ fontSize: 13, color: COLORS.dim, lineHeight: 1.6, marginBottom: 12 }}>{path.why}</div>

      <SectionTitle>Matched conditions</SectionTitle>
      <div style={{ marginBottom: 12 }}>
        {path.matchedConditions.map((m) => (
          <div key={m.id} style={{ fontSize: 12.5, marginBottom: 6 }}>
            <Pill color={COLORS.green}>{m.id}</Pill>
            <span style={{ color: COLORS.dim }}>{m.triggerSummary}</span>
            <span style={{ color: COLORS.faint, fontSize: 11.5 }}> [{m.sourceId} · {m.locator}]</span>
          </div>
        ))}
      </div>

      <SectionTitle>Permits ({path.permits.length})</SectionTitle>
      {path.permits.length === 0 ? (
        <div style={{ color: COLORS.amber, fontSize: 13 }}>
          ⚠ Variant triggered but resolved to zero permits — reported by the evaluator, not silently dropped.
        </div>
      ) : (
        path.permits.map((p) => (
          <div
            key={p.ruleId}
            style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 12px", marginBottom: 6, background: COLORS.panel2 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
              {p.title} <span style={{ color: COLORS.faint, fontWeight: 400, fontSize: 11.5 }}>{p.ruleId}</span>
            </div>
            <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>
              {p.citation}
              {p.citationUrl && (
                <a href={p.citationUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.accent, marginLeft: 8 }}>
                  source ↗
                </a>
              )}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

function NegativePathRow({ np }: { np: NegativePath }) {
  return (
    <div style={{ fontSize: 12.5, padding: "8px 0", borderBottom: `1px solid ${COLORS.border}` }}>
      <Pill color={np.kind === "scenario" ? COLORS.faint : COLORS.purple}>{np.kind}</Pill>
      <span style={{ color: COLORS.text, fontWeight: 600 }}>{np.id}</span>
      <span style={{ color: COLORS.faint }}> — {np.label}</span>
      <div style={{ color: COLORS.dim, marginTop: 3 }}>{np.reason}</div>
      {np.blockedBy.length > 0 && (
        <div style={{ color: COLORS.faint, fontSize: 11.5, marginTop: 2 }}>
          blocked by: {np.blockedBy.join(", ")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab.
// ---------------------------------------------------------------------------

type Section = "scenarios" | "adhoc" | "suite" | "health";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "scenarios", label: "Scenarios" },
  { id: "adhoc", label: "Ad-hoc test" },
  { id: "suite", label: "Golden suite" },
  { id: "health", label: "Graph health" },
];

export function ReasoningPathsTab(props: {
  // Accepted for interface consistency with the other KB tabs and reserved for
  // future remediation actions; this tab is read-only QA today.
  onSaved: (msg: string) => void;
}) {
  void props.onSaved;
  const [section, setSection] = useState<Section>("scenarios");

  // Graph browser state
  const [graph, setGraph] = useState<GraphSummary | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  // Ad-hoc state
  const [bools, setBools] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BOOLEAN_FACTS.map((f) => [f.key, false]))
  );
  const [utilityType, setUtilityType] = useState("");
  const [businessActivity, setBusinessActivity] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [employees, setEmployees] = useState("");
  const [energyKw, setEnergyKw] = useState("");
  const [adhocResult, setAdhocResult] = useState<ReasoningPathResult | null>(null);
  const [adhocError, setAdhocError] = useState<string | null>(null);
  const [adhocRunning, setAdhocRunning] = useState(false);

  // Suite + health state
  const [suite, setSuite] = useState<SuiteEntry[] | null>(null);
  const [suiteNote, setSuiteNote] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationFinding[] | null>(null);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [expandedFixture, setExpandedFixture] = useState<string | null>(null);

  const condById = useMemo(
    () => new Map((graph?.conditions ?? []).map((c) => [c.id, c])),
    [graph]
  );

  const loadGraph = async () => {
    setGraphError(null);
    try {
      const res = await fetch("/api/admin/reasoning-paths/run");
      const data = await res.json();
      if (!res.ok) {
        setGraphError(data.message || data.error || "failed to load graph");
        setGraph(null);
      } else {
        setGraph(data as GraphSummary);
      }
    } catch (e) {
      setGraphError((e as Error).message);
      setGraph(null);
    }
  };

  const runSuite = async () => {
    setSuiteRunning(true);
    setSuiteError(null);
    try {
      const res = await fetch("/api/admin/reasoning-paths/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suite: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSuiteError(data.message || data.error || "suite run failed");
      } else {
        setSuite((data.suite ?? []) as SuiteEntry[]);
        setSuiteNote((data.suiteNote ?? null) as string | null);
        setValidation((data.validation ?? []) as ValidationFinding[]);
      }
    } catch (e) {
      setSuiteError((e as Error).message);
    } finally {
      setSuiteRunning(false);
    }
  };

  // Initial load: graph summaries + full suite (populates golden table and health).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadGraph();
      if (!cancelled) await runSuite();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildFacts = (): FactBag => {
    const facts: FactBag = { ...bools };
    facts.utility_type = utilityType || null;
    facts.business_activity = businessActivity || null;
    facts.municipality = municipality.trim() || null;
    facts.employees = employees.trim() === "" ? null : Number(employees);
    facts.energy_capacity_kw = energyKw.trim() === "" ? null : Number(energyKw);
    return facts;
  };

  const runAdhoc = async () => {
    setAdhocRunning(true);
    setAdhocError(null);
    try {
      const res = await fetch("/api/admin/reasoning-paths/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts: buildFacts() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdhocError(data.message || data.error || "run failed");
        setAdhocResult(null);
      } else {
        setAdhocResult((data.result ?? data) as ReasoningPathResult);
      }
    } catch (e) {
      setAdhocError((e as Error).message);
      setAdhocResult(null);
    } finally {
      setAdhocRunning(false);
    }
  };

  // Preset from the QA commission: "I bought an existing restaurant in Guaynabo.
  // It will remain a restaurant, but I am remodeling the kitchen and ownership
  // has changed." (input facts only — expectations live in the golden fixture)
  const loadComplexPreset = () => {
    setBools({
      ...Object.fromEntries(BOOLEAN_FACTS.map((f) => [f.key, false])),
      existing_business: true,
      existing_location: true,
      same_use: true,
      remodeling: true,
      ownership_changed: true,
      commercial_use: true,
      food_service: true,
    });
    setBusinessActivity("restaurant");
    setMunicipality("Guaynabo");
    setUtilityType("");
    setEmployees("");
    setEnergyKw("");
  };

  const clearFacts = () => {
    setBools(Object.fromEntries(BOOLEAN_FACTS.map((f) => [f.key, false])));
    setUtilityType("");
    setBusinessActivity("");
    setMunicipality("");
    setEmployees("");
    setEnergyKw("");
    setAdhocResult(null);
    setAdhocError(null);
  };

  const relatedVariants = (s: ScenarioSummary): VariantSummary[] =>
    (graph?.variants ?? []).filter((v) =>
      v.selectorConditions.some(
        (c) => s.requiredConditions.includes(c) || s.excludedConditions.includes(c)
      )
    );

  const suitePass = suite?.filter((s) => s.pass).length ?? 0;
  const validationErrors = validation?.filter((f) => f.severity === "error") ?? [];
  const validationWarnings = validation?.filter((f) => f.severity === "warning") ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`kb-tab ${section === s.id ? "active" : ""}`}
          >
            {s.label}
            {s.id === "health" && validation && validationErrors.length > 0 && (
              <span style={{ color: COLORS.red, marginLeft: 6 }}>● {validationErrors.length}</span>
            )}
            {s.id === "suite" && suite && (
              <span style={{ color: suitePass === suite.length ? COLORS.green : COLORS.red, marginLeft: 6 }}>
                {suitePass}/{suite.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ 1. Scenarios */}
      {section === "scenarios" && (
        <div>
          {graphError && <ErrorBanner msg={graphError} />}
          {!graph && !graphError && (
            <div style={{ color: COLORS.faint, padding: 40, textAlign: "center" }}>Loading graph…</div>
          )}
          {graph && (
            <div style={{ color: COLORS.faint, fontSize: 12, marginBottom: 10 }}>
              {graph.scenarios.length} scenarios · {graph.conditions.length} conditions · {graph.variants.length} variants
            </div>
          )}
          {(graph?.scenarios ?? []).map((s) => {
            const expanded = expandedScenario === s.id;
            const rel = relatedVariants(s);
            return (
              <div key={s.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, marginBottom: 8, background: COLORS.panel }}>
                <button
                  onClick={() => setExpandedScenario(expanded ? null : s.id)}
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 16px", cursor: "pointer" }}
                >
                  <div style={{ color: COLORS.text, fontSize: 13.5, fontWeight: 700 }}>
                    {expanded ? "▾" : "▸"} {s.label}
                  </div>
                  <div style={{ color: COLORS.faint, fontSize: 11.5, marginTop: 2 }}>
                    {s.id} · {s.requiredConditions.length} required · {s.excludedConditions.length} excluded · {rel.length} related variant{rel.length === 1 ? "" : "s"}
                  </div>
                </button>
                {expanded && (
                  <div style={{ padding: "4px 16px 16px", borderTop: `1px solid ${COLORS.border}` }}>
                    {s.description && <div style={{ color: COLORS.dim, fontSize: 13, margin: "8px 0 12px" }}>{s.description}</div>}
                    <div className="kb-split s360" style={{ marginTop: 8 }}>
                      <div>
                        <SectionTitle color={COLORS.green}>Required conditions</SectionTitle>
                        {s.requiredConditions.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12 }}>None.</div>}
                        {s.requiredConditions.map((c) => <ConditionRef key={c} cond={condById.get(c)} />)}
                      </div>
                      <div>
                        <SectionTitle color={COLORS.red}>Excluded conditions</SectionTitle>
                        {s.excludedConditions.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12 }}>None.</div>}
                        {s.excludedConditions.map((c) => <ConditionRef key={c} cond={condById.get(c)} />)}
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <SectionTitle>Related variants (share conditions)</SectionTitle>
                      {rel.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12 }}>No variants share conditions with this scenario.</div>}
                      {rel.map((v) => (
                        <div key={v.id} style={{ fontSize: 12.5, padding: "8px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                          <Pill color={v.active ? COLORS.green : COLORS.faint}>{v.active ? "active" : "inactive"}</Pill>
                          <span style={{ color: COLORS.text, fontWeight: 600 }}>{v.id}</span>
                          <span style={{ color: COLORS.faint }}> — {v.label} · process {v.processId}</span>
                          {v.supersededBy && <span style={{ color: COLORS.amber }}> · superseded by {v.supersededBy}</span>}
                          <div style={{ color: COLORS.faint, fontSize: 11.5, marginTop: 2 }}>
                            selectors: {v.selectorConditions.join(", ") || "—"} · rules: {v.ruleIds.length}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------ 2. Ad-hoc test */}
      {section === "adhoc" && (
        <div>
          <Card>
            <SectionTitle>Input facts (v1 catalog)</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "6px 16px", marginBottom: 16 }}>
              {BOOLEAN_FACTS.map((f) => (
                <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.dim, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!bools[f.key]}
                    onChange={(e) => setBools((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                  />
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{f.key}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>municipality</label>
                <input value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder="e.g. Guaynabo" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>business_activity</label>
                <select value={businessActivity} onChange={(e) => setBusinessActivity(e.target.value)} style={selectStyle}>
                  {BUSINESS_ACTIVITIES.map((a) => <option key={a} value={a}>{a || "—"}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>utility_type</label>
                <select value={utilityType} onChange={(e) => setUtilityType(e.target.value)} style={selectStyle}>
                  {UTILITY_TYPES.map((u) => <option key={u} value={u}>{u || "—"}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>employees</label>
                <input value={employees} onChange={(e) => setEmployees(e.target.value)} inputMode="numeric" placeholder="number" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>energy_capacity_kw</label>
                <input value={energyKw} onChange={(e) => setEnergyKw(e.target.value)} inputMode="decimal" placeholder="number" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn primary onClick={runAdhoc} disabled={adhocRunning}>
                {adhocRunning ? "Running…" : "Run reasoning paths"}
              </Btn>
              <Btn onClick={loadComplexPreset}>Load complex preset (Guaynabo restaurant)</Btn>
              <Btn onClick={clearFacts}>Clear</Btn>
            </div>
          </Card>

          {adhocError && <ErrorBanner msg={adhocError} />}
          {adhocResult && (
            <div>
              <div style={{ color: COLORS.faint, fontSize: 12.5, marginBottom: 12 }}>
                {adhocResult.scenarios.length} scenario{adhocResult.scenarios.length === 1 ? "" : "s"} detected ·{" "}
                {adhocResult.paths.length} path{adhocResult.paths.length === 1 ? "" : "s"} triggered ·{" "}
                {adhocResult.permits.length} permit{adhocResult.permits.length === 1 ? "" : "s"} ·{" "}
                {adhocResult.negativePaths.length} negative path{adhocResult.negativePaths.length === 1 ? "" : "s"}
              </div>
              {adhocResult.paths.map((p) => (
                <PathCard key={`${p.scenarioId}::${p.variantId}`} path={p} />
              ))}
              {adhocResult.paths.length === 0 && (
                <div style={{ color: COLORS.faint, padding: "20px 10px", textAlign: "center", border: `1px dashed ${COLORS.border}`, borderRadius: 10, marginBottom: 12 }}>
                  No paths triggered for these facts.
                </div>
              )}
              <Collapsible title="Negative paths — why scenarios/variants did not apply" count={adhocResult.negativePaths.length}>
                {adhocResult.negativePaths.length === 0 && (
                  <div style={{ color: COLORS.faint, fontSize: 12.5, padding: "8px 0" }}>None.</div>
                )}
                {adhocResult.negativePaths.map((np) => (
                  <NegativePathRow key={`${np.kind}:${np.id}`} np={np} />
                ))}
              </Collapsible>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ 3. Golden suite */}
      {section === "suite" && (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <Btn primary onClick={runSuite} disabled={suiteRunning}>
              {suiteRunning ? "Running…" : "Run full suite"}
            </Btn>
            {suite && (
              <span style={{ fontSize: 13, color: suitePass === suite.length ? COLORS.green : COLORS.red, fontWeight: 700 }}>
                {suitePass}/{suite.length} passed
              </span>
            )}
            {suiteNote && <span style={{ fontSize: 12, color: COLORS.faint }}>{suiteNote}</span>}
          </div>
          {suiteError && <ErrorBanner msg={suiteError} />}
          {suite && suite.length === 0 && !suiteNote && (
            <div style={{ color: COLORS.faint, padding: 30, textAlign: "center" }}>No fixtures found.</div>
          )}
          {suite && suite.length > 0 && (
            <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
              {suite.map((entry) => {
                const expanded = expandedFixture === entry.id;
                return (
                  <div key={entry.id} style={{ borderBottom: `1px solid ${COLORS.border}`, background: expanded ? COLORS.panel : "transparent" }}>
                    <button
                      onClick={() => setExpandedFixture(expanded ? null : entry.id)}
                      style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 14px", cursor: "pointer", display: "flex", gap: 10, alignItems: "center" }}
                    >
                      <Pill color={entry.pass ? COLORS.green : COLORS.red}>{entry.pass ? "PASS" : "FAIL"}</Pill>
                      <span style={{ color: COLORS.text, fontSize: 13, fontWeight: 600 }}>{entry.id}</span>
                      <span style={{ color: COLORS.faint, fontSize: 12 }}>{entry.name}</span>
                      {!entry.pass && entry.diffs.length > 0 && (
                        <span style={{ color: COLORS.faint, fontSize: 12, marginLeft: "auto" }}>{expanded ? "▾" : "▸"} {entry.diffs.length} diff{entry.diffs.length === 1 ? "" : "s"}</span>
                      )}
                    </button>
                    {expanded && !entry.pass && (
                      <div style={{ padding: "4px 14px 14px 14px" }}>
                        {entry.diffs.map((d, i) => (
                          <div key={i} style={{ fontFamily: "monospace", fontSize: 12, color: "#fca5a5", padding: "3px 0" }}>
                            {d}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ 4. Graph health */}
      {section === "health" && (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <Btn onClick={runSuite} disabled={suiteRunning}>
              {suiteRunning ? "Checking…" : "Re-check graph health"}
            </Btn>
            {validation && (
              <span style={{ fontSize: 13, color: COLORS.dim }}>
                {validationErrors.length} error{validationErrors.length === 1 ? "" : "s"} · {validationWarnings.length} warning{validationWarnings.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {suiteError && <ErrorBanner msg={suiteError} />}
          {!validation && !suiteError && (
            <div style={{ color: COLORS.faint, padding: 30, textAlign: "center" }}>No validation data yet — run the check.</div>
          )}
          {validation && validation.length === 0 && (
            <div style={{ background: COLORS.green + "15", border: `1px solid ${COLORS.green}55`, color: "#a7f3d0", borderRadius: 10, padding: "14px 16px", fontSize: 13 }}>
              ✓ Graph is healthy — no errors or warnings.
            </div>
          )}
          {(validation ?? []).map((f, i) => (
            <div
              key={i}
              style={{
                background: (f.severity === "error" ? COLORS.red : COLORS.amber) + "12",
                border: `1px solid ${(f.severity === "error" ? COLORS.red : COLORS.amber)}55`,
                borderRadius: 10, padding: "10px 14px", marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: f.severity === "error" ? "#fca5a5" : "#fcd34d" }}>
                {f.severity === "error" ? "✕ ERROR" : "⚠ WARNING"}
                <span style={{ fontWeight: 400, marginLeft: 8, fontFamily: "monospace", fontSize: 12 }}>{f.code}</span>
                {f.entityId && <span style={{ fontWeight: 400, marginLeft: 8, fontFamily: "monospace", fontSize: 12 }}>{f.entityId}</span>}
              </div>
              <div style={{ fontSize: 12.5, color: COLORS.dim, marginTop: 4 }}>{f.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
