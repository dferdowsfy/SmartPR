"use client";

// ============================================================================
// Regulatory Knowledge Graph Admin — client shell.
//
// Top-level tabs: Graph · Requirements · Reasoning Paths · Forms ·
// Regulatory Sources · Proposed Changes · Impact Analysis · Publications ·
// Audit Log.
// A state indicator switches the working view: Live Rules / Draft Changes /
// Proposed Bill Preview (the "Proposed Future State" layer).
// ============================================================================

import { useState } from "react";
import { COLORS, KB_CSS, StatusBadge } from "./ui";
import { INCENTIVE_NODE_TYPES, NODE_TYPE_CONFIGS } from "../../rk/registry";
import type { GraphMode, NodeType } from "../../rk/types";
import { useGraphData } from "./graph/useGraphData";
import { GraphView } from "./graph/GraphView";
import { DetailPanel } from "./graph/DetailPanel";
import { RequirementsTab } from "./tabs/RequirementsTab";
import { ReasoningPathsTab } from "./tabs/ReasoningPathsTab";
import { SourcesTab } from "./tabs/SourcesTab";
import { ProposalsTab } from "./tabs/ProposalsTab";
import { PublicationsTab } from "./tabs/PublicationsTab";
import { AuditTab } from "./tabs/AuditTab";
import { ImpactTab } from "./tabs/ImpactTab";
import { FormsTab } from "./tabs/FormsTab";
import { ReasoningTab } from "./tabs/ReasoningTab";

const TABS = [
  { id: "graph", label: "Graph" },
  { id: "reasoning", label: "Reasoning Paths" },
  { id: "requirements", label: "Requirements" },
  { id: "reasoning-paths", label: "Reasoning Paths" },
  { id: "incentives", label: "Incentives & Programs" },
  { id: "forms", label: "Forms" },
  { id: "sources", label: "Regulatory Sources" },
  { id: "proposals", label: "Proposed Changes" },
  { id: "impact", label: "Impact Analysis" },
  { id: "publications", label: "Publications" },
  { id: "audit", label: "Audit Log" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const INCENTIVE_ADMIN_TYPES: NodeType[] = [
  ...INCENTIVE_NODE_TYPES,
  "eligibility_criterion",
  "benefit",
  "application_window",
  "project_fact",
  "regulatory_source",
  "agency",
  "industry",
  "municipality",
  "evidence_type",
];

const MODES: { id: GraphMode; label: string; hint: string }[] = [
  { id: "live", label: "Live Rules", hint: "What production users get today" },
  { id: "draft", label: "Draft Changes", hint: "Live + open manual/enacted proposals" },
  { id: "proposed", label: "Proposed Bill Preview", hint: "Future state from unenacted bills (e.g. PS 1173) — never affects live users" },
];

export default function KnowledgeBaseShell() {
  const [tab, setTab] = useState<TabId>("graph");
  const [mode, setMode] = useState<GraphMode>("live");
  const [inspected, setInspected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const graph = useGraphData(mode);

  const saved = (msg: string) => {
    setToast(msg);
    setInspected(null);
    graph.refresh();
    window.setTimeout(() => setToast(null), 8000);
  };

  const counts = graph.graph?.counts ?? {};
  const incentiveCount = INCENTIVE_NODE_TYPES.reduce((total, type) => total + (counts[type] ?? 0), 0);
  const stat = (t: keyof typeof NODE_TYPE_CONFIGS, label?: string) => (
    <span style={{ color: COLORS.dim, fontSize: 12, whiteSpace: "nowrap" }}>
      <span style={{ color: NODE_TYPE_CONFIGS[t].color, fontWeight: 800 }}>{counts[t] ?? 0}</span>{" "}
      {label ?? NODE_TYPE_CONFIGS[t].plural.toLowerCase()}
    </span>
  );

  return (
    <div className="kbadmin" style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: KB_CSS }} />
      <div style={{ background: COLORS.purple, padding: "6px 24px", fontSize: 12, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>
        ADMIN — REGULATORY KNOWLEDGE GRAPH — INTERNAL USE ONLY
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: COLORS.text, margin: 0 }}>Regulatory Knowledge Graph</h1>
            <p style={{ color: COLORS.dim, fontSize: 13, margin: "4px 0 0" }}>
              Puerto Rico business requirements and government opportunities — edit structured rules,
              ingest official sources, review proposed changes, and publish versioned updates.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
              {stat("municipality")}
              {stat("business_type")}
              {stat("intake_question", "questions")}
              {stat("document", "documents & permits")}
              {stat("rule", "rules")}
              {stat("agency", "agencies")}
              <span style={{ color: COLORS.dim, fontSize: 12, whiteSpace: "nowrap" }}>
                <span style={{ color: NODE_TYPE_CONFIGS.incentive.color, fontWeight: 800 }}>{incentiveCount}</span>{" "}
                incentive programs
              </span>
              {stat("eligibility_criterion", "eligibility criteria")}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", gap: 6, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 999, padding: 4 }}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  title={m.hint}
                  style={{
                    border: "none",
                    borderRadius: 999,
                    padding: "7px 14px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: mode === m.id ? (m.id === "live" ? COLORS.green : m.id === "draft" ? COLORS.amber : COLORS.purple) + "33" : "transparent",
                    color: mode === m.id ? COLORS.text : COLORS.faint,
                    outline: mode === m.id ? `1px solid ${m.id === "live" ? COLORS.green : m.id === "draft" ? COLORS.amber : COLORS.purple}` : "none",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div style={{ color: COLORS.faint, fontSize: 11, marginTop: 4, textAlign: "right" }}>
              {MODES.find((m) => m.id === mode)?.hint}
            </div>
          </div>
        </div>

        {!graph.enabled && !graph.loading && (
          <div style={{ background: COLORS.amber + "15", border: `1px solid ${COLORS.amber}55`, color: "#fcd34d", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>
            No database connected — showing the bundled knowledge base, read-only.
            {graph.error ? ` (${graph.error})` : ""} Set DATABASE_URL to enable editing, ingestion, and publishing.
          </div>
        )}

        {toast && (
          <div style={{ background: COLORS.green + "18", border: `1px solid ${COLORS.green}66`, color: "#a7f3d0", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14, display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>{toast}</span>
            <span role="button" onClick={() => setToast(null)} style={{ cursor: "pointer", color: COLORS.faint }}>✕</span>
          </div>
        )}

        <div className="kb-tabs">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`kb-tab ${tab === t.id ? "active" : ""}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "graph" && (
          <div className={inspected ? "kb-split detail" : undefined}>
            <div>
              {graph.loading && !graph.graph ? (
                <div style={{ color: COLORS.faint, padding: 60, textAlign: "center" }}>Loading graph…</div>
              ) : graph.graph ? (
                <GraphView graph={graph.graph} onInspect={(id) => setInspected(id)} />
              ) : null}
              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: COLORS.faint, fontSize: 12 }}>Legend:</span>
                <StatusBadge status="active" />
                <StatusBadge status="proposed" />
                <StatusBadge status="superseded" />
                <StatusBadge status="archived" />
                <span style={{ color: COLORS.faint, fontSize: 12 }}>
                  Relationships connect business facts, requirements, evidence, agencies, sources,
                  eligibility criteria, benefits, and incentive programs.
                </span>
              </div>
            </div>
            {inspected && (
              <DetailPanel entityId={inspected} graph={graph} onClose={() => setInspected(null)} onSaved={saved} />
            )}
          </div>
        )}

        {tab === "reasoning" && <ReasoningTab graph={graph} onSaved={saved} />}
        {tab === "requirements" && <RequirementsTab graph={graph} onSaved={saved} />}
        {tab === "reasoning-paths" && <ReasoningPathsTab onSaved={saved} />}
        {tab === "incentives" && (
          <RequirementsTab
            graph={graph}
            onSaved={saved}
            initialType="incentive"
            allowedTypes={INCENTIVE_ADMIN_TYPES}
            intro={(
              <div style={{ marginBottom: 14, padding: 14, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.panel }}>
                <div style={{ color: COLORS.text, fontWeight: 750, fontSize: 14 }}>Reviewed incentive publication workflow</div>
                <div style={{ color: COLORS.dim, fontSize: 12.5, lineHeight: 1.55, marginTop: 4 }}>
                  Public source → AI-extracted candidate → structured criteria and benefits → human/legal validation → publication batch → live eligibility matching.
                  Drafts and proposals never affect customer results. Active programs missing complete source, version, agency, criterion, or benefit links are rejected by the runtime catalog.
                </div>
              </div>
            )}
          />
        )}
        {tab === "forms" && <FormsTab enabled={graph.enabled} />}
        {tab === "sources" && <SourcesTab enabled={graph.enabled} onProposals={() => setTab("proposals")} />}
        {tab === "proposals" && <ProposalsTab enabled={graph.enabled} onChanged={() => graph.refresh()} />}
        {tab === "impact" && <ImpactTab enabled={graph.enabled} />}
        {tab === "publications" && <PublicationsTab enabled={graph.enabled} onChanged={() => graph.refresh()} />}
        {tab === "audit" && <AuditTab enabled={graph.enabled} />}
      </div>
    </div>
  );
}
