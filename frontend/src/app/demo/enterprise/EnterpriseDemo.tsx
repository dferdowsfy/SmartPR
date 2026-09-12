"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Building2, Check, CheckCircle2, ExternalLink, FileText, GitBranch, RotateCcw, ShieldCheck, X } from "lucide-react";
import { SmartPRLogo } from "../../components/brand/SmartPRLogo";
import { RequirementCard } from "../../components/filing/RequirementCard";
import { ReadinessControl } from "../../components/filing/ReadinessControl";
import { GovernmentFormRenderer } from "../../forms/engine/GovernmentFormRenderer";
import { GovernmentFormPreview } from "../../forms/engine/GovernmentFormPreview";
import { prefillFromCanonical, writeBackToCanonical } from "../../forms/engine/canonicalMapping";
import { resolveFormId } from "../../forms/engine/routing";
import { getDefinition } from "../../forms/engine/registry";
import { validateForm } from "../../forms/engine/formValidation";
import type { FormData, FormFieldValue } from "../../forms/engine/types";
import { buildProject, canonicalFor, COMPANY, DEMO_VERSION, evidenceKey, projects, readiness, regulatoryEvent, regulatoryStates, seedEvidence, tenant, type DemoRequirement, type EvidenceState, type EvidenceStatus, type ProjectId } from "./model";
import styles from "./enterprise.module.css";

type View = "overview" | "profile" | "requirements" | "evidence" | "forms" | "regulations" | "portfolio";
const views: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "profile", label: "Project profile" },
  { id: "requirements", label: "Requirements" }, { id: "evidence", label: "Evidence & gaps" },
  { id: "forms", label: "Government forms" }, { id: "regulations", label: "Regulatory updates" }, { id: "portfolio", label: "Portfolio" },
];
const formCanonical = canonicalFor("bayamon");
const formId = projects.find(p => p.id === "bayamon")?.requirements.some(r => r.document_id === "DOC_PATENTE_MUNICIPAL")
  ? resolveFormId("DOC_PATENTE_MUNICIPAL", formCanonical) : null;
const formDefinition = formId ? getDefinition(formId) : null;
const sampleName = (r: DemoRequirement) => `Sample · ${r.name}`;
const statusLabel: Record<EvidenceStatus, string> = { missing: "Missing", review: "Needs review", verified: "Verified evidence" };

function Pill({ status }: { status: EvidenceStatus }) {
  return <span className={`${styles.pill} ${styles[status]}`}>{status === "verified" && <Check size={13} />}{statusLabel[status]}</span>;
}
function Panel({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return <section className={styles.panel}><div className={styles.panelTitle}><h2>{title}</h2>{extra}</div>{children}</section>;
}
function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} className={styles.drawer} aria-labelledby="demo-drawer-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.drawerHead}><h2 id="demo-drawer-title">{title}</h2><button autoFocus onClick={onClose} aria-label="Close panel"><X size={20} /></button></div>{children}
  </dialog>;
}

export default function EnterpriseDemo() {
  const [view, setView] = useState<View>("overview");
  const [projectId, setProjectId] = useState<ProjectId>("guaynabo");
  const [evidence, setEvidence] = useState<EvidenceState>(seedEvidence);
  const [renovations, setRenovations] = useState(true);
  const [selected, setSelected] = useState<DemoRequirement | null>(null);
  const [sourceSelected, setSourceSelected] = useState<DemoRequirement | null>(null);
  const [canonical, setCanonical] = useState(formCanonical);
  const [formData, setFormData] = useState<FormData>(() => formDefinition ? prefillFromCanonical(formDefinition, formCanonical) : {});
  const [showForm, setShowForm] = useState(false);
  const [previewForm, setPreviewForm] = useState(false);
  const [validate, setValidate] = useState(false);
  const [eventStage, setEventStage] = useState(0);
  const [message, setMessage] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const portfolio = useMemo(() => projects.map(p => p.id === "guaynabo" ? buildProject("guaynabo", renovations) : p), [renovations]);
  const project = portfolio.find(p => p.id === projectId)!;
  const stats = readiness(project, evidence);
  const status = (r: DemoRequirement): EvidenceStatus => evidence[evidenceKey(projectId, r.document_id)] ?? "missing";
  const gaps = [...stats.missing, ...stats.review];
  const go = (next: View) => { setView(next); setMessage(""); window.scrollTo({ top: 0 }); };
  const updateEvidence = (r: DemoRequirement, value: EvidenceStatus) => {
    setEvidence(prev => ({ ...prev, [evidenceKey(projectId, r.document_id)]: value }));
    setMessage(value === "verified" ? "Sample evidence verified in this demo session. Readiness recalculated." : "Sample evidence linked for review. No readiness credit until verified.");
  };
  const reset = () => {
    setEvidence(seedEvidence()); setRenovations(true); setProjectId("guaynabo"); setView("overview");
    setCanonical(canonicalFor("bayamon")); setFormData(formDefinition ? prefillFromCanonical(formDefinition, canonicalFor("bayamon")) : {});
    setShowForm(false); setPreviewForm(false); setValidate(false); setSelected(null); setSourceSelected(null); setEventStage(0); setResetOpen(false);
    setMessage("Demo reset. Original project facts, sample evidence, and forms restored."); window.scrollTo({ top: 0 });
  };
  const formErrors = formDefinition && validate ? validateForm(formDefinition, formData, canonical) : [];

  return <div className={styles.root} style={{ "--demo-accent": tenant.accent } as CSSProperties}>
    <header className={styles.topbar}><button className={styles.brand} onClick={() => go("overview")} aria-label="SmartPR demo overview"><SmartPRLogo size="app" /></button><span className={styles.topbarDivider} /><span className={styles.org}>{tenant.name}</span><span className={styles.demoBadge}>Demo</span><button className={styles.reset} onClick={() => setResetOpen(true)}><RotateCcw size={14} />Reset demo</button></header>
    <main className={styles.main}>
      <div className={styles.breadcrumb}><Building2 size={15} /><button onClick={() => go("portfolio")}>{tenant.terminology.portfolio}</button><span>/</span><span>{project.municipality}</span></div>
      <div className={styles.heading}><div><p className={styles.eyebrow}>{view === "portfolio" ? "MULTI-FACILITY OPERATIONS" : "EXISTING BUSINESS · FACILITY PROJECT"}</p><h1>{view === "portfolio" ? "One portfolio. Every facility." : project.title}</h1><p>{view === "portfolio" ? `${projects.length} fictional facilities · ${COMPANY}` : `${project.municipality}, Puerto Rico · ${project.activity}`}</p></div><ReadinessControl language="en" pct={stats.score} total={stats.total} completed={stats.complete.length} needsAction={stats.missing.length} inProgress={stats.review.length} /></div>
      <nav className={styles.tabs} aria-label="Enterprise demo sections">{views.map(v => <button key={v.id} onClick={() => go(v.id)} aria-current={view === v.id ? "page" : undefined}>{v.label}{v.id === "requirements" && <span>{stats.total}</span>}</button>)}</nav>
      {message && <div className={styles.message} role="status"><CheckCircle2 size={17} />{message}</div>}

      {view === "overview" && <>
        <div className={styles.metrics}>
          <div><span>Evidence readiness</span><strong>{stats.score}<small>%</small></strong><div className={styles.progress}><i style={{ width: `${stats.score}%` }} /></div><p>{stats.complete.length} of {stats.total} supported requirements verified</p></div>
          <button onClick={() => go("requirements")}><span>Complete</span><strong>{stats.complete.length}</strong><p>Evidence linked to requirement nodes</p></button>
          <button onClick={() => go("evidence")}><span>Missing requirements</span><strong>{stats.missing.length}</strong><p>Resolve before assembling the package</p></button>
          <button onClick={() => go("requirements")}><span>Applicability reviews</span><strong>{project.reviews.length}</strong><p>Excluded from readiness until confirmed</p></button>
        </div>
        <div className={styles.twoCol}>
          <Panel title="Next actions" extra={<span className={styles.meta}>In priority order</span>}>
            {gaps.map((r, i) => <button className={styles.actionRow} key={r.document_id} onClick={() => { setSelected(r); go("evidence"); }}><span className={styles.number}>{i + 1}</span><span><strong>{r.name}</strong><small>{r.guidance.nextAction}</small></span><ArrowRight size={18} /></button>)}
            {!gaps.length && <div className={styles.success}><ShieldCheck />All supported evidence is verified. Resolve the remaining applicability reviews before declaring submission readiness.</div>}
            <button className={styles.actionRow} onClick={() => go("requirements")}><span className={styles.number}>{gaps.length + 1}</span><span><strong>Resolve construction and local applicability</strong><small>Human review of the knowledge-pack coverage gaps.</small></span><ArrowRight size={18} /></button>
          </Panel>
          <Panel title="Project context"><dl className={styles.facts}><div><dt>Organization</dt><dd>{COMPANY}</dd></div><div><dt>Activity</dt><dd>{project.type}</dd></div><div><dt>Premises</dt><dd>Existing leased facility · operational business</dd></div><div><dt>People onsite</dt><dd>{project.employees} employees</dd></div><div><dt>Responsible person</dt><dd>{project.owner}</dd></div><div><dt>Next internal review</dt><dd>{project.actionDate} · sample target</dd></div></dl><button className={styles.textButton} onClick={() => go("profile")}>Review the project facts <ArrowRight size={15} /></button></Panel>
        </div>
        <Panel title="How this project is evaluated" extra={<GitBranch size={18} />}><div className={styles.chain}>{["Project facts", "Matched rules", "Requirements", "Evidence", "Gaps", "Readiness"].map((s, i) => <span key={s}>{s}{i < 5 && <ArrowRight size={15} />}</span>)}</div><p className={styles.note}>Readiness measures the supported scope in this knowledge pack. Unresolved applicability reviews prevent a claim that the entire expansion is submission-ready.</p></Panel>
      </>}

      {view === "profile" && <div className={styles.twoCol}>
        <Panel title="Confirmed project facts"><dl className={styles.facts}>
          {[["Legal name", COMPANY], ["Municipality", project.municipality], ["Entity", "Existing Puerto Rico LLC"], ["Business activity", project.type], ["Location", "Industrial / commercial facility"], ["Occupancy", "Existing building · leased"], ["Operational status", "Operating"], ["Employees onsite", String(project.employees)], ["Proposed activity", project.activity]].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>{projectId === "guaynabo" && <label className={styles.toggle}><input type="checkbox" checked={renovations} onChange={e => { setRenovations(e.target.checked); setMessage("Project facts updated. The existing rules engine re-evaluated applicability."); }} /><span><strong>Construction / renovations involved</strong><small>Toggle to inspect the resulting rule matches.</small></span></label>}</Panel>
        <Panel title="Applicability trace" extra={<span className={styles.meta}>{project.trace.rulesMatched.length} matched rules</span>}>
          <p className={styles.note}>These are actual matches from SmartPR’s bundled rules engine. A match still needs sufficient source coverage before becoming an active requirement.</p>
          <div className={styles.trace}>{project.trace.questionsTriggered.map(q => <div key={q.question_id}><code>{q.question_id}</code><strong>{q.question}</strong><span>Confirmed: {String(q.answer)}</span></div>)}</div>
          <div className={styles.coverage}><strong>Construction coverage</strong><p>{project.input.answers.Q_RENOVATIONS ? "The renovation answer matches the existing Contractor License candidate. Its agency and applicability need validation; SmartPR does not treat it as a confirmed obligation of the manufacturer." : "No renovation trigger is active. The construction-related candidate has been removed by the rules engine."}</p></div>
        </Panel>
      </div>}

      {view === "requirements" && <>
        <div className={styles.sectionIntro}><div><h2>Supported requirements</h2><p>Project facts, regulatory basis, and evidence — connected.</p></div><button className={styles.secondary} onClick={() => go("profile")}><GitBranch size={16} />Inspect project facts</button></div>
        <div className={styles.cards}>{project.requirements.map((r, i) => <RequirementCard key={r.document_id} index={i + 1} icon={<FileText size={20} />} iconTone="green" name={r.name} agency={r.agency} description={r.guidance.purpose} badge={{ label: statusLabel[status(r)], tone: status(r) === "missing" ? "amber" : "gray" }} whyLabel="Why do I need this?" why={<>
          <div className={styles.whyGrid}><div><h4>Why it applies</h4><p>{r.guidance.whyThisApplies}</p><p className={styles.meta}>{project.type} in {project.municipality} · {r.guidance.triggeredBy.join(" · ")}</p></div><div><h4>What to provide</h4><p>{r.guidance.whatYouNeedToDo}</p></div><div><h4>What happens next</h4><p>{r.guidance.whatHappensNext}</p></div><div><h4>Source / regulatory basis</h4>{r.guidance.sources.map(s => <p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.citation} <ExternalLink size={12} /></a></p>)}</div></div>
          <p className={styles.meta}>Prerequisites: {r.guidance.dependencies.length ? r.guidance.dependencies.map(d => d === "DOC_ARTICLES_ORGANIZATION" ? "Articles of Organization — existing corporate reference evidence" : d).join(", ") : "No prerequisite edge recorded in this knowledge pack."}</p>
        </>} action={{ kind: "form", label: status(r) === "verified" ? "View evidence" : "Review gap", onClick: () => setSelected(r) }} extra={<div className={styles.provenance}><span>Verified in knowledge pack: {r.guidance.lastVerified || "Not recorded"}</span><span>Guidance v{r.guidance.sourceVersion}</span><button onClick={() => setSourceSelected(r)}>Source & change history <ArrowRight size={13} /></button></div>} />)}</div>
        <Panel title="Applicability & coverage reviews" extra={<span className={styles.pill}>{project.reviews.length} candidates</span>}><p className={styles.note}>These candidates are not confirmed legal obligations and do not affect the score.</p><div className={styles.reviewList}>{project.reviews.map(r => <details key={r.document_id}><summary><span>{r.name}</span><span className={styles.review}>Human review</span></summary><p>{r.coverageReason}</p><p className={styles.meta}>Matched project condition: {r.reason} · {r.source_rule_id}</p><p className={styles.meta}>Active requirement: no · Verified for this project: no</p></details>)}</div></Panel>
      </>}

      {view === "evidence" && <>
        <div className={styles.sectionIntro}><div><h2>What is missing?</h2><p>{gaps.length} evidence gaps · {project.reviews.length} separate applicability reviews</p></div><span className={styles.meta}>Required → Evidence → Status</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Requirement</th><th>Linked evidence</th><th>Status</th><th>Readiness credit</th><th /></tr></thead><tbody>{[...gaps, ...stats.complete].map(r => { const point = stats.points.find(p => p.id === r.document_id)!; return <tr key={r.document_id}><td><strong>{r.name}</strong><small>{r.agency}</small></td><td>{status(r) === "missing" ? "No evidence linked" : sampleName(r)}<small>{r.document_id}</small></td><td><Pill status={status(r)} /></td><td>{Math.round(point.earned)} / {Math.round(point.weight)} pts</td><td><button className={styles.textButton} onClick={() => setSelected(r)}>Inspect <ArrowRight size={15} /></button></td></tr>; })}</tbody></table></div>
        <div className={styles.twoCol}><Panel title="Evidence readiness calculation"><div className={styles.scoreLine}><strong>{stats.score}%</strong><span>{stats.complete.length} verified / {stats.total} supported requirements</span></div><div className={styles.progress}><i style={{ width: `${stats.score}%` }} /></div><p className={styles.note}>Equal weights from the pinned pack. Missing or unverified evidence earns zero. Uploading a sample does not mark it verified.</p><p className={styles.note}>Regulatory review candidates remain outside the denominator; this score is not approval to operate.</p></Panel>
        <Panel title="Project reference documents"><div className={styles.reference}><CheckCircle2 size={18} /><div><strong>Corporate documentation</strong><p>Sample Articles of Organization · reference node DOC_ARTICLES_ORGANIZATION · recorded prerequisite to EIN.</p></div></div><div className={styles.reference}><CheckCircle2 size={18} /><div><strong>Site documentation & existing plans</strong><p>Sample lease and existing plans are available as project context. They do not stand in for an agency-issued certificate or automatically earn readiness credit.</p></div></div><p className={styles.meta}>Fictional reference records, not real certificates.</p></Panel></div>
      </>}

      {view === "forms" && <>
        <div className={styles.sectionIntro}><div><h2>Information entered once. Reused in the form.</h2><p>Separate portfolio example: Bayamón Warehouse · existing operation</p></div></div>
        <div className={styles.coverage}><strong>Annual filing example — not a Guaynabo construction filing</strong><p>The existing form registry routes an operating Puerto Rico business’s Patente Municipal requirement to PA01. Financial schedules, taxpayer classification, signatures, and local submission conditions still require the filer’s review.</p></div>
        {formDefinition ? <>
          <Panel title="Annual Municipal Business Volume Declaration (PA01)" extra={<span className={styles.pill}>Existing SmartPR workflow</span>}><div className={styles.twoCol}><dl className={styles.facts}><div><dt>Company data</dt><dd>{canonical.business.legalName}</dd></div><div><dt>Municipality</dt><dd>{canonical.addresses.municipality}</dd></div><div><dt>Activity</dt><dd>{canonical.business.activityDescription}</dd></div><div><dt>Official document</dt><dd>{formDefinition.sourceDocument}</dd></div><div><dt>Schema</dt><dd>v{formDefinition.version} · extracted from official PDF</dd></div></dl><div><p className={styles.note}>Company, contact, location, and activity fields are pre-populated through SmartPR’s canonical mapping. Edits stay in this demo session.</p><button className={styles.primary} onClick={() => { setShowForm(true); setPreviewForm(false); }}>{showForm ? "Return to editable form" : "Open government form"}<ArrowRight size={16} /></button></div></div></Panel>
          {showForm && <Panel title={previewForm ? "Prepared draft preview" : "Complete the remaining fields"} extra={<button className={styles.textButton} onClick={() => setPreviewForm(!previewForm)}>{previewForm ? "Edit form" : "Preview draft"}</button>}>
            <div className={styles.form}>{previewForm ? <GovernmentFormPreview definition={formDefinition} canonical={canonical} formData={formData} lang="en" /> : <GovernmentFormRenderer definition={formDefinition} canonical={canonical} formData={formData} lang="en" errors={formErrors} onChange={(id, value) => { const next = { ...formData, [id]: value as FormFieldValue }; setFormData(next); setCanonical(writeBackToCanonical(formDefinition, next, canonical).canonical); }} />}</div>
            <div className={styles.formActions}><button className={styles.primary} onClick={() => { setValidate(true); const errors = validateForm(formDefinition, formData, canonical); setMessage(errors.length ? `Draft retained in this session. ${errors.length} required fields or checks remain. No filing submitted.` : "Draft fields validated. Financial schedules and signature still require review. No filing submitted."); }}>Check draft</button><span className={styles.meta}>Session only · no submission · no change to evidence readiness</span></div>
          </Panel>}
        </> : <Panel title="Form coverage"><p>No verified form is available in this build. Do not substitute an invented government form.</p></Panel>}
      </>}

      {view === "regulations" && <>
        <div className={styles.sectionIntro}><div><h2>Versioned regulations. Controlled changes.</h2><p>Source review → impact assessment → approval → effective publication</p></div></div>
        <Panel title={regulatoryEvent.title} extra={<span className={styles.demoBadge}>Illustrative event</span>}><div className={styles.notice}><ShieldCheck size={22} /><div><strong>{regulatoryEvent.message}</strong><p>No real bill or regulatory announcement is represented here.</p></div></div>
          <div className={styles.lifecycle} role="group" aria-label="Explore regulatory lifecycle">{regulatoryStates.map((s, i) => <button key={s.legalStatus} aria-pressed={eventStage === i} onClick={() => setEventStage(i)}>{s.label}</button>)}</div>
          <div className={styles.twoCol}><div className={styles.version}><span className={styles.eyebrow}>SELECTED LIFECYCLE EXPLANATION</span><h3>{regulatoryStates[eventStage].label}</h3><p>{regulatoryStates[eventStage].description}</p><code>{regulatoryStates[eventStage].legalStatus}</code></div><div className={styles.version}><span className={styles.eyebrow}>ACTUAL DEMO EVENT STATE</span><h3>Proposed · awaiting human review</h3><dl className={styles.facts}><div><dt>Current / candidate</dt><dd>{regulatoryEvent.beforeVersion} / {regulatoryEvent.candidateVersion}</dd></div><div><dt>Effective date</dt><dd>Not established</dd></div><div><dt>Reviewer approval</dt><dd>Not granted</dd></div><div><dt>Changed project requirements</dt><dd>0</dd></div></dl></div></div>
          <p className={styles.note}>Exploring lifecycle states does not change this event or any requirements. The production regulatory-knowledge system already separates proposals, impact analysis, and publication; this panel is a read-only illustration of that process.</p>
        </Panel>
        <Panel title="Requirement provenance"><div className={styles.reviewList}>{project.requirements.map(r => <button className={styles.actionRow} key={r.document_id} onClick={() => setSourceSelected(r)}><FileText size={18} /><span><strong>{r.name}</strong><small>Knowledge-pack verification: {r.guidance.lastVerified} · version {r.guidance.sourceVersion}</small></span><ArrowRight size={16} /></button>)}</div></Panel>
      </>}

      {view === "portfolio" && <>
        <div className={styles.metrics}><div><span>Facilities</span><strong>{projects.length}</strong><p>One shared requirements engine</p></div><div><span>Open evidence requirements</span><strong>{portfolio.reduce((n,p) => n + readiness(p,evidence).missing.length + readiness(p,evidence).review.length, 0)}</strong><p>Missing or awaiting verification</p></div><div><span>Regulatory changes applied</span><strong>0</strong><p>One illustrative development monitored</p></div><div><span>Upcoming internal reviews</span><strong>5</strong><p>Seeded targets, not statutory deadlines</p></div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Project / facility</th><th>Readiness</th><th>Open / review</th><th>Priority deficiency</th><th>Owner</th><th>Next review</th></tr></thead><tbody>{portfolio.map(p => { const s = readiness(p,evidence); return <tr key={p.id}><td><button className={styles.projectLink} onClick={() => { setProjectId(p.id); go("overview"); }}>{p.title}<ArrowRight size={14} /></button><small>{p.municipality} · {p.type}</small></td><td><strong>{s.score}%</strong><div className={styles.miniProgress}><i style={{ width: `${s.score}%` }} /></div></td><td>{s.missing.length + s.review.length} evidence<small>{p.reviews.length} applicability</small></td><td>{s.missing[0]?.name ?? (s.review.length ? "Evidence verification" : "Applicability review")}</td><td>{p.owner}</td><td>{p.actionDate}<small>Internal target</small></td></tr>; })}</tbody></table></div>
        <div className={styles.twoCol}><Panel title="Renewals & deadlines"><p>Bayamón Warehouse has an annual municipal filing example ready for review.</p><p className={styles.note}>No statutory due date is asserted by this demo. The filing period and applicable deadline must be confirmed before scheduling a renewal.</p><button className={styles.textButton} onClick={() => go("forms")}>Open annual filing example <ArrowRight size={16} /></button></Panel><Panel title="Recently changed regulations"><p>No effective regulatory changes applied to these projects.</p><p className={styles.note}>One explicitly fictional proposed event is monitored with no customer action.</p><button className={styles.textButton} onClick={() => go("regulations")}>Inspect monitored development <ArrowRight size={16} /></button></Panel></div>
      </>}
      <footer className={styles.footer}><span>SmartPR · {DEMO_VERSION} · fictional company and evidence</span><span>Isolated session · refresh or reset to restore</span></footer>
    </main>

    {selected && <Drawer title={selected.name} onClose={() => setSelected(null)}><div className={styles.drawerBody}>
      <Pill status={status(selected)} /><p>{selected.guidance.whatYouNeedToDo}</p><dl className={styles.facts}><div><dt>Requirement node</dt><dd><code>{selected.document_id}</code></dd></div><div><dt>Matched rule</dt><dd><code>{selected.source_rule_id}</code></dd></div><div><dt>Project</dt><dd>{project.title}</dd></div><div><dt>Evidence</dt><dd>{status(selected) === "missing" ? "Not yet provided" : sampleName(selected)}</dd></div><div><dt>Evidence provenance</dt><dd>Deterministic fictional sample · not an agency-issued document</dd></div></dl>
      <h3>Requirement → evidence → readiness</h3><p className={styles.note}>Link a sample record, review it, then verify it. The shared weighting function recalculates readiness from requirement status.</p>
      {status(selected) === "missing" && <button className={styles.primary} onClick={() => updateEvidence(selected,"review")}>Link sample evidence <ArrowRight size={16} /></button>}
      {status(selected) === "review" && <><div className={styles.coverage}><strong>Sample review checklist</strong><p>Company and facility match · document type matches the requirement · no sample expiry issue.</p><p>This demonstration does not run document extraction or certify an actual document.</p></div><button className={styles.primary} onClick={() => updateEvidence(selected,"verified")}>Verify sample evidence <CheckCircle2 size={16} /></button></>}
      {status(selected) === "verified" && <div className={styles.success}><ShieldCheck size={20} /><span>Sample evidence satisfies this node in the demo. {Math.round(stats.points.find(p => p.id === selected.document_id)?.earned ?? 0)} readiness points earned.</span></div>}
      <div role="status" className={styles.note}>{message}</div><button className={styles.textButton} onClick={() => { setSourceSelected(selected); setSelected(null); }}>Inspect official source <ExternalLink size={15} /></button>
    </div></Drawer>}

    {sourceSelected && <Drawer title="Source & change history" onClose={() => setSourceSelected(null)}><div className={styles.drawerBody}><h3>{sourceSelected.name}</h3><p className={styles.note}>Verification dates are recorded in the existing knowledge pack, not a claim of a fresh legal review today.</p>{sourceSelected.guidance.sources.map(s => <section className={styles.source} key={s.id}><span className={styles.eyebrow}>{s.agency}</span><h3>{s.citation}</h3><p>{s.supports}</p><a href={s.url} target="_blank" rel="noreferrer">Official source <ExternalLink size={14} /></a><dl className={styles.facts}><div><dt>Verified</dt><dd>{s.lastVerified}</dd></div><div><dt>Source version</dt><dd>{s.sourceVersion}</dd></div></dl></section>)}<h3>Available history</h3><div className={styles.version}><strong>Guidance v{sourceSelected.guidance.sourceVersion}</strong><p>Bundled published guidance · verified {sourceSelected.guidance.lastVerified}.</p><p className={styles.note}>Earlier revisions are not included in this snapshot. No invented historical changes.</p></div><button className={styles.textButton} onClick={() => { setSourceSelected(null); go("regulations"); }}>View regulatory change controls <ArrowRight size={16} /></button></div></Drawer>}
    {resetOpen && <Drawer title="Reset enterprise demo?" onClose={() => setResetOpen(false)}><div className={styles.drawerBody}><p>This restores the original fictional projects, evidence states, and form drafts. Only this demo session is affected.</p><button className={styles.primary} onClick={reset}><RotateCcw size={16} />Reset demo</button></div></Drawer>}
  </div>;
}
