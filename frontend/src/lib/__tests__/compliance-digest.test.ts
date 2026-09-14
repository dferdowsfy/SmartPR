// Unit tests for the monthly compliance digest (spec section 10, revised).
// Run with: npx tsx --test src/lib/__tests__/compliance-digest.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  isMuted,
  setComplianceMailerForTests,
  type PreferenceRow,
} from "../compliance-reminders";
import {
  DIGEST_CAPS,
  buildNeedsFromYou,
  classifyObligation,
  computeDigestHealth,
  isDigestMuted,
  matchChangesForBusinesses,
  resolveItemContent,
  runComplianceDigestCron,
  type ClassifiedObligation,
  type DigestObligationRow,
} from "../compliance-digest";
import {
  buildDigestEmail,
  bucketComingItem,
  bucketDigestItem,
  executiveSummary,
  sortDigestSoonestFirst,
  type DigestActionItem,
  type DigestComingItem,
  type DigestEmailInput,
} from "../compliance-digest-emails";

// ---------------------------------------------------------------------------
// bucketComingItem / sortDigestSoonestFirst / bucketDigestItem
// ---------------------------------------------------------------------------

test("bucketComingItem: 31..60 → 60, 61..90 → 90, else null", () => {
  for (const d of [31, 45, 60]) assert.equal(bucketComingItem(d), "60", String(d));
  for (const d of [61, 75, 90]) assert.equal(bucketComingItem(d), "90", String(d));
  for (const d of [-5, 0, 30, 91, 365]) assert.equal(bucketComingItem(d), null, String(d));
});

test("bucketDigestItem unchanged: ≤30 → dueSoon, 31..90 → dueLater, 91+ → null", () => {
  for (const d of [-30, 0, 30]) assert.equal(bucketDigestItem(d), "dueSoon", String(d));
  for (const d of [31, 90]) assert.equal(bucketDigestItem(d), "dueLater", String(d));
  for (const d of [91, 365]) assert.equal(bucketDigestItem(d), null, String(d));
});

test("sortDigestSoonestFirst orders soonest first (overdue first)", () => {
  const items = [{ daysRemaining: 30 }, { daysRemaining: -5 }, { daysRemaining: 7 }];
  const sorted = sortDigestSoonestFirst(items);
  assert.deepEqual(sorted.map((i) => i.daysRemaining), [-5, 7, 30]);
});

// ---------------------------------------------------------------------------
// executiveSummary
// ---------------------------------------------------------------------------

test("executiveSummary builds 2–3 sentences from counts (EN + ES)", () => {
  const en = executiveSummary("en", 2, 3, 1);
  assert.match(en, /2 actions requiring attention/);
  assert.match(en, /3 requirements approaching within 90 days/);
  assert.match(en, /1 regulatory development that may affect your operation/);
  const es = executiveSummary("es", 1, 1, 2);
  assert.match(es, /1 acción que requiere atención/);
  assert.match(es, /1 requisito próximo/);
  assert.match(es, /2 cambios regulatorios que pueden afectar tu operación/);
});

test("executiveSummary all-zero variant is an all-clear sentence", () => {
  assert.match(executiveSummary("en", 0, 0, 0), /Everything is current/);
  assert.match(executiveSummary("es", 0, 0, 0), /Todo está al día/);
});

// ---------------------------------------------------------------------------
// resolveItemContent — graph guidance wins, honest fallbacks otherwise
// ---------------------------------------------------------------------------

const baseRow: DigestObligationRow = {
  id: "o1",
  name: "Permiso Único",
  agency: "OGPe",
  status: "DUE_SOON",
  due_date: "2026-10-11",
  due_date_source: "USER_PROVIDED",
  renewal_frequency_months: 12,
  updated_at: "2026-09-20T00:00:00Z",
  requirement_id: "DOC_PERMISO_UNICO",
  next_action: null,
  source_reference: "RULE_0001",
  mandatory: true,
  evidence_count: 1,
  business_id: "b1",
  business_name: "Café Luna",
  business_public_id: "abc123",
  business_type: "restaurant",
  industry: "food",
  municipality: "San Juan",
  business_structure: "llc",
};

test("resolveItemContent uses the validated guidance concept when available", () => {
  const c = resolveItemContent(baseRow, "en", false);
  // DOC_PERMISO_UNICO has a validated concept: nextAction mentions SBP.
  assert.match(c.whatToDo, /SBP/);
  assert.match(c.whyApplies, /Permiso Único/i);
  assert.ok(c.risk.length > 20);
  const es = resolveItemContent(baseRow, "es", false);
  assert.match(es.whatToDo, /SBP/);
  assert.ok(!es.whatToDo.includes("Prepare the renewal filing"), "no English fallback when guidance exists");
});

test("resolveItemContent falls back honestly when no guidance concept exists", () => {
  const row = { ...baseRow, requirement_id: "DOC_SOMETHING_UNKNOWN" };
  const c = resolveItemContent(row, "en", false);
  assert.match(c.whatToDo, /Prepare the renewal filing/);
  assert.match(c.whyApplies, /RULE_0001/);
  assert.match(c.risk, /fines/);
  // Overdue risk copy differs from the due-soon copy.
  const overdue = resolveItemContent(row, "en", true);
  assert.match(overdue.risk, /Operating past a deadline/);
});

// ---------------------------------------------------------------------------
// classifyObligation + computeDigestHealth
// ---------------------------------------------------------------------------

function classified(over: Partial<DigestObligationRow> = {}): ClassifiedObligation {
  const row = { ...baseRow, ...over };
  const out = classifyObligation(row, {
    now: new Date("2026-10-01T12:00:00Z"),
    planId: "operator",
    coveredBusinessId: null,
    prefs: [],
  });
  assert.ok(out, "expected in-scope obligation");
  return out;
}

test("classifyObligation computes daysRemaining, overdue, and labels", () => {
  const o = classified({ due_date: "2026-09-28" }); // -3 days
  assert.equal(o.daysRemaining, -3);
  assert.equal(o.overdue, true);
  assert.equal(o.applicability, "confirmed");
  const unknown = classified({ status: "UNKNOWN", source_reference: null });
  assert.equal(unknown.applicability, "likely");
  const optional = classified({ mandatory: false });
  assert.equal(optional.applicability, "conditional");
  const completed = classifyObligation(
    { ...baseRow, status: "COMPLETED" },
    { now: new Date(), planId: "operator", coveredBusinessId: null, prefs: [] }
  );
  assert.equal(completed, null);
});

test("computeDigestHealth: current/total with honest exclusions", () => {
  const rows = [
    classified({ id: "a", due_date: "2026-10-11", evidence_count: 1 }), // due in 10d → not current
    classified({ id: "b", due_date: "2026-11-15", status: "UPCOMING", evidence_count: 1 }), // current
    classified({ id: "c", status: "IN_PROGRESS", due_date: null, due_date_source: "UNKNOWN", updated_at: "2026-09-01T00:00:00Z", evidence_count: 0 }), // stalled → not current
    classified({ id: "d", status: "CURRENT", due_date: null, due_date_source: "UNKNOWN", evidence_count: 0, updated_at: "2026-09-20T00:00:00Z" }), // renewable, no stored date → not current
    classified({ id: "e", status: "UNKNOWN", due_date: null, due_date_source: "UNKNOWN", source_reference: null, evidence_count: 0, updated_at: "2026-09-20T00:00:00Z" }), // needs verification → not current
  ];
  const h = computeDigestHealth(rows);
  assert.equal(h.total, 5);
  assert.equal(h.current, 1);
  assert.equal(h.percent, 20);
  assert.equal(h.needsVerification, 1);
  assert.equal(h.overdue, 0);
  assert.equal(h.upcoming, 3); // a + b (due ≤90) + c (stalled)
});

test("computeDigestHealth: overdue items are critical and never current", () => {
  const rows = [classified({ id: "a", due_date: "2026-09-20", evidence_count: 1 })]; // -11 days
  const h = computeDigestHealth(rows);
  assert.equal(h.overdue, 1);
  assert.equal(h.current, 0);
  assert.equal(h.percent, 0);
});

// ---------------------------------------------------------------------------
// buildNeedsFromYou
// ---------------------------------------------------------------------------

test("buildNeedsFromYou surfaces info/date/evidence gaps, never invents dates", () => {
  const rows = [
    classified({ id: "a", status: "UNKNOWN", source_reference: null, due_date: null, due_date_source: "UNKNOWN", updated_at: "2026-09-20T00:00:00Z" }),
    classified({ id: "b", status: "CURRENT", due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: 12, updated_at: "2026-09-20T00:00:00Z" }),
    classified({ id: "c", status: "DUE_SOON", due_date: "2026-10-11", evidence_count: 0 }),
  ];
  const items = buildNeedsFromYou(rows, "en");
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.kind), ["info", "date", "evidence"]);
  assert.match(items[1].detail, /no expiry date stored/);
  assert.match(items[2].cta, /Upload evidence/);
  const es = buildNeedsFromYou(rows, "es");
  assert.match(es[1].detail, /fecha de vencimiento/);
});

// ---------------------------------------------------------------------------
// buildDigestEmail — new structure, branding, bilingual
// ---------------------------------------------------------------------------

function actionItem(over: Partial<DigestActionItem> = {}): DigestActionItem {
  return {
    obligationId: "o1",
    name: "Patente Municipal",
    businessName: "Café Luna",
    businessRef: "abc123",
    agency: "Municipio de San Juan",
    dueDate: "2026-10-11",
    daysRemaining: 10,
    daysStalled: null,
    overdue: false,
    whatToDo: "Prepare the renewal filing.",
    whyApplies: "Applies to commercial activity in San Juan.",
    risk: "Missing the deadline can mean fines.",
    applicability: "confirmed",
    actionUrl: "https://www.getsmartpr.com/businesses/abc123#obligation-o1",
    ...over,
  };
}

function comingItem(over: Partial<DigestComingItem> = {}): DigestComingItem {
  return {
    obligationId: "o2",
    name: "Merchant Registration",
    businessName: "Café Luna",
    businessRef: "abc123",
    agency: "Hacienda",
    dueDate: "2026-11-15",
    daysRemaining: 45,
    prepNow: "Review the renewal requirements.",
    applicability: "confirmed",
    actionUrl: "https://www.getsmartpr.com/businesses/abc123#obligation-o2",
    window: "60",
    ...over,
  };
}

function emailInput(over: Partial<DigestEmailInput> = {}): DigestEmailInput {
  return {
    lang: "en",
    businessLabel: "Café Luna",
    monthLabel: "October 2026",
    userName: "Darius",
    actionCount: 1,
    upcomingCount: 1,
    changeCount: 1,
    actionRequired: [actionItem()],
    comingUp: [comingItem()],
    changes: [
      {
        developmentId: "d1",
        title: "OGPe updates Permiso Único renewal",
        summary: "The renewal window is extended by 30 days.",
        businessName: "Café Luna",
        effectiveDate: "2026-11-01",
        publishedDate: "2026-09-20",
        whyAffects: 'Affects your requirement "Permiso Único".',
        recommendedAction: "File early anyway.",
        sourceName: "OGPe",
        sourceUrl: "https://www.ogpe.pr.gov/notice",
        confidence: "high",
        applicability: "confirmed",
      },
    ],
    needsFromYou: [
      {
        kind: "date",
        name: "Bomberos Cert",
        businessName: "Café Luna",
        businessRef: "abc123",
        agency: "Bomberos",
        detail: "This renewal has no expiry date stored.",
        cta: "Add date",
        actionUrl: "https://x/#o4",
      },
    ],
    health: { percent: 75, total: 4, current: 3, upcoming: 2, needsVerification: 0, overdue: 1 },
    overflow: { action: 0, coming: 0, changes: 0, needs: 0 },
    dashboardUrl: "https://www.getsmartpr.com/dashboard",
    complianceCenterUrl: "https://www.getsmartpr.com/compliance",
    manageUrl: "https://www.getsmartpr.com/settings",
    unsubscribeUrl: "https://www.getsmartpr.com/api/notifications/unsubscribe?token=t",
    ...over,
  };
}

test("buildDigestEmail: new structure, branding, and section order", () => {
  const built = buildDigestEmail(emailInput());
  // Branding from getsmartpr.com.
  assert.ok(built.html.includes("#f4f1ea"), "paper background");
  assert.ok(built.html.includes("#245c5c"), "brand teal");
  assert.ok(built.html.includes("IBM Plex Sans"), "brand font");
  assert.ok(!built.html.includes("#0f2a43"), "old navy gone");
  // Header + executive summary.
  assert.ok(built.html.includes("SMARTPR MONTHLY COMPLIANCE DIGEST"));
  assert.ok(built.html.includes("Café Luna"));
  assert.ok(built.html.includes("1 action requiring attention"));
  assert.ok(built.html.includes("1 requirement approaching within 90 days"));
  assert.ok(built.html.includes("1 regulatory development that may affect your operation"));
  // Sections in order.
  const order = ["Action required", "Coming up", "What changed", "SmartPR needs from you", "Compliance health"];
  let last = -1;
  for (const title of order) {
    const idx = built.html.indexOf(title);
    assert.ok(idx > last, `${title} in order`);
    last = idx;
  }
  // Action item carries what/why/risk + CTA + label chip.
  for (const s of ["What needs to happen", "Why it applies to you", "If you miss it", "Review Requirement", "Confirmed"]) {
    assert.ok(built.html.includes(s), s);
  }
  // Change item carries source, confidence, applicability reasoning.
  for (const s of ["OGPe updates Permiso Único renewal", "OGPe", "High confidence", 'Affects your requirement']) {
    assert.ok(built.html.includes(s), s);
  }
  // Health + CTA.
  assert.ok(built.html.includes("75%"));
  assert.ok(built.html.includes("Open Compliance Center"));
  assert.ok(built.html.includes("https://www.getsmartpr.com/compliance"));
  // Text version mirrors the structure.
  assert.ok(built.text.includes("ACTION REQUIRED"));
  assert.ok(built.text.includes("WHAT CHANGED"));
  assert.ok(built.text.includes("COMPLIANCE HEALTH"));
});

test("buildDigestEmail: WHAT CHANGED fallback when nothing matched", () => {
  const built = buildDigestEmail(emailInput({ changes: [], changeCount: 0 }));
  assert.ok(built.html.includes("No material regulatory changes affecting your SmartPR profile were identified this month."));
  assert.ok(built.text.includes("No material regulatory changes"));
});

test("buildDigestEmail: only relevant sections render + overflow line", () => {
  const built = buildDigestEmail(
    emailInput({ actionRequired: [], comingUp: [comingItem()], needsFromYou: [], actionCount: 0, upcomingCount: 4, overflow: { action: 0, coming: 3, changes: 0, needs: 0 } })
  );
  assert.ok(!built.html.includes("Action required"), "action section hidden");
  assert.ok(!built.html.includes("SmartPR needs from you"), "needs section hidden");
  assert.ok(built.html.includes("+3 more in SmartPR"), "overflow line");
});

test("buildDigestEmail: Spanish is boricua, fully localized", () => {
  const built = buildDigestEmail(
    emailInput({
      lang: "es",
      monthLabel: "octubre de 2026",
      actionRequired: [actionItem({ whatToDo: "Prepara la radicación.", whyApplies: "Te aplica por tu local.", risk: "Multas." })],
    })
  );
  assert.match(built.subject, /resumen de cumplimiento/);
  for (const s of ["Requiere acción", "Lo que viene", "Lo que cambió", "SmartPR necesita de ti", "Salud de cumplimiento", "Revisar requisito", "Abrir el Centro de Cumplimiento", "Qué hay que hacer", "Por qué te aplica", "Si se te pasa"]) {
    assert.ok(built.html.includes(s), s);
  }
  assert.ok(built.html.includes("1 acción que requiere atención"));
  assert.ok(!built.html.includes("ordenador"), "no peninsular Spanish");
});

test("buildDigestEmail: all-clear when nothing to show", () => {
  const built = buildDigestEmail(
    emailInput({ actionRequired: [], comingUp: [], changes: [], needsFromYou: [], actionCount: 0, upcomingCount: 0, changeCount: 0 })
  );
  assert.ok(built.html.includes("All clear"));
  assert.ok(built.html.includes("Compliance health"));
});

// ---------------------------------------------------------------------------
// matchChangesForBusinesses
// ---------------------------------------------------------------------------

test("matchChangesForBusinesses: requirement-code match wins with basis", () => {
  const items = matchChangesForBusinesses(
    [
      {
        id: "d1", title: "T", summary: "S", sourceName: "OGPe", sourceUrl: "https://www.ogpe.pr.gov/x",
        publishedDate: "2026-09-20", effectiveDate: null,
        affectedRequirementCodes: ["DOC_PERMISO_UNICO"],
        agencyNames: [], municipalities: [], businessTypes: [], industries: [], requirementNames: [],
        applicabilityNotes: null, recommendedAction: null, confidence: "high",
      },
    ],
    [{ businessId: "b1", businessName: "Café Luna", businessType: "restaurant", industry: "food", municipality: "San Juan", businessStructure: "llc" }],
    [{ obligationId: "o3", obligationName: "Permiso Único", requirementId: "DOC_PERMISO_UNICO", agency: "OGPe", businessId: "b1" }],
    "en"
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].applicability, "confirmed");
  assert.match(items[0].whyAffects, /Affects your requirement "Permiso Único"/);
});

test("matchChangesForBusinesses: no targeting criteria → never shown", () => {
  const items = matchChangesForBusinesses(
    [
      {
        id: "d9", title: "Generic PR news", summary: "S", sourceName: "News", sourceUrl: "https://example.com/x",
        publishedDate: "2026-09-20", effectiveDate: null,
        affectedRequirementCodes: [],
        agencyNames: [], municipalities: [], businessTypes: [], industries: [], requirementNames: [],
        applicabilityNotes: null, recommendedAction: null, confidence: "high",
      },
    ],
    [{ businessId: "b1", businessName: "Café Luna", businessType: "restaurant", industry: "food", municipality: "San Juan", businessStructure: "llc" }],
    [{ obligationId: "o3", obligationName: "Permiso Único", requirementId: "DOC_PERMISO_UNICO", agency: "OGPe", businessId: "b1" }],
    "en"
  );
  assert.equal(items.length, 0);
});

// ---------------------------------------------------------------------------
// isDigestMuted — unchanged behavior
// ---------------------------------------------------------------------------

const prefsOf = (p: Partial<PreferenceRow> & { scope: PreferenceRow["scope"] }): PreferenceRow => ({
  business_id: null,
  obligation_id: null,
  muted: true,
  ...p,
});

test("isDigestMuted: digest mute and global mute stop the digest", () => {
  assert.equal(isDigestMuted([prefsOf({ scope: "digest" })]), true);
  assert.equal(isDigestMuted([prefsOf({ scope: "global" })]), true);
  assert.equal(isDigestMuted([prefsOf({ scope: "business", business_id: "b1" })]), false);
  assert.equal(isDigestMuted([prefsOf({ scope: "digest", muted: false })]), false);
  assert.equal(isDigestMuted([]), false);
});

test("digest opt-out is independent of transactional reminders (and vice versa)", () => {
  const target = { businessId: "b1", obligationId: "o1" };
  assert.equal(isMuted([prefsOf({ scope: "digest" })], target), false);
  assert.equal(isDigestMuted([prefsOf({ scope: "business", business_id: "b1" })]), false);
  assert.equal(isMuted([prefsOf({ scope: "global" })], target), true);
  assert.equal(isDigestMuted([prefsOf({ scope: "global" })]), true);
});

// ---------------------------------------------------------------------------
// Cron (fake db)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
interface FakeTables {
  businesses: Row[];
  obligations: Row[];
  members: Row[];
  subscriptions: Record<string, string>;
  prefs: Row[];
  digestLog: Row[];
  developments: Row[];
  shows: Row[];
  users: Record<string, { email: string; lang: string; name: string }>;
  templates: Row[];
  archive: Row[];
}

function baseTables(): FakeTables {
  return {
    businesses: [
      { id: "b1", legal_name: "Café Luna", name: "Café Luna", workspace_id: "w-op", user_id: "u1", public_id: "abc123", archived: false, created_at: "2026-01-01T00:00:00Z", business_type: "restaurant", industry: "food", municipality: "San Juan", business_structure: "llc" },
      { id: "b2", legal_name: "Taller Sol", name: "Taller Sol", workspace_id: "w-op", user_id: "u1", public_id: "def456", archived: false, created_at: "2026-06-01T00:00:00Z", business_type: "auto_repair", industry: "automotive", municipality: "Yabucoa", business_structure: "corp" },
    ],
    obligations: [
      { id: "o1", name: "Patente Municipal", agency: "Municipio", status: "DUE_SOON", due_date: "2026-10-11", due_date_source: "USER_PROVIDED", renewal_frequency_months: 12, updated_at: "2026-09-20T00:00:00Z", business_id: "b1", requirement_id: "DOC_PATENTE_MUNICIPAL", next_action: null, source_reference: "RULE_0001", mandatory: true, evidence_count: 1 },
      { id: "o2", name: "Merchant Registration", agency: "Hacienda", status: "UPCOMING", due_date: "2026-11-15", due_date_source: "USER_PROVIDED", renewal_frequency_months: 24, updated_at: "2026-09-20T00:00:00Z", business_id: "b1", requirement_id: "DOC_MERCHANT_REGISTRATION", next_action: null, source_reference: "RULE_0002", mandatory: true, evidence_count: 1 },
      { id: "o3", name: "Permiso Único", agency: "OGPe", status: "IN_PROGRESS", due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: 12, updated_at: "2026-09-01T00:00:00Z", business_id: "b1", requirement_id: "DOC_PERMISO_UNICO", next_action: null, source_reference: "RULE_0003", mandatory: true, evidence_count: 0 },
      { id: "o4", name: "Bomberos Cert", agency: "Bomberos", status: "CURRENT", due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: 12, updated_at: "2026-09-20T00:00:00Z", business_id: "b2", requirement_id: "DOC_FIRE_CERT", next_action: null, source_reference: "RULE_0004", mandatory: true, evidence_count: 0 },
      { id: "o5", name: "Mystery requirement", agency: null, status: "UNKNOWN", due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: null, updated_at: "2026-09-20T00:00:00Z", business_id: "b1", requirement_id: null, next_action: null, source_reference: null, mandatory: true, evidence_count: 0 },
      { id: "o6", name: "Done already", agency: null, status: "COMPLETED", due_date: "2026-10-05", due_date_source: "USER_PROVIDED", renewal_frequency_months: 12, updated_at: "2026-09-20T00:00:00Z", business_id: "b1", requirement_id: null, next_action: null, source_reference: "RULE_0006", mandatory: true, evidence_count: 1 },
    ],
    members: [{ workspace_id: "w-op", user_id: "u1", role: "OWNER", created_at: "2026-01-01T00:00:00Z" }],
    subscriptions: { "w-op": "operator" },
    prefs: [],
    digestLog: [],
    developments: [
      { id: "d1", title: "OGPe updates Permiso Único renewal", summary: "Renewal window extended.", source_name: "OGPe", source_url: "https://www.ogpe.pr.gov/notice", published_date: "2026-09-20", effective_date: null, affected_requirement_codes: ["DOC_PERMISO_UNICO"], agency_names: [], municipalities: [], business_types: [], industries: [], requirement_names: [], applicability_notes: "Affects all Permiso Único holders.", recommended_action: "File early anyway.", confidence: "high", review_status: "verified" },
      { id: "d2", title: "Unverified rumor", summary: "Not checked.", source_name: "Blog", source_url: "https://example.com/x", published_date: "2026-09-21", effective_date: null, affected_requirement_codes: ["DOC_PERMISO_UNICO"], agency_names: [], municipalities: [], business_types: [], industries: [], requirement_names: [], applicability_notes: null, recommended_action: null, confidence: "low", review_status: "unreviewed" },
      { id: "d3", title: "Fishing license change", summary: "Irrelevant.", source_name: "DRNA", source_url: "https://www.drna.pr.gov/x", published_date: "2026-09-22", effective_date: null, affected_requirement_codes: ["DOC_FISHING_LICENSE"], agency_names: [], municipalities: [], business_types: [], industries: [], requirement_names: [], applicability_notes: null, recommended_action: null, confidence: "high", review_status: "verified" },
    ],
    shows: [],
    users: { u1: { email: "owner@example.com", lang: "en", name: "Darius" } },
    templates: [],
    archive: [],
  };
}

function makeDb(t: FakeTables) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      const p = params as string[];
      if (s.includes("DISTINCT workspace_id")) {
        const ids = [...new Set(t.businesses.filter((b) => !b.archived && b.workspace_id).map((b) => String(b.workspace_id)))];
        return { rows: ids.map((id) => ({ workspace_id: id })) };
      }
      if (s.includes("FROM workspace_subscriptions")) {
        const plan = t.subscriptions[String(p[0])] || "free";
        return { rows: [{ plan, status: "active" }] };
      }
      if (s.includes("FROM compliance_digest_log")) {
        const hit = t.digestLog.some((l) => String(l.workspace_id) === String(p[0]) && String(l.period) === String(p[1]));
        return { rows: hit ? [{ "1": 1 }] : [] };
      }
      if (s.includes("FROM workspace_members")) {
        const m = t.members.find((x) => String(x.workspace_id) === String(p[0]) && x.role === "OWNER");
        if (m) return { rows: [{ user_id: m.user_id }] };
        const b = t.businesses.find((x) => String(x.workspace_id) === String(p[0]) && x.user_id);
        return { rows: b ? [{ user_id: b.user_id }] : [] };
      }
      if (s.includes("FROM notification_preferences")) {
        return {
          rows: t.prefs
            .filter((x) => String(x.user_id) === String(p[0]))
            .map((x) => ({ scope: x.scope, business_id: x.business_id ?? null, obligation_id: x.obligation_id ?? null, muted: x.muted })),
        };
      }
      if (s.includes("FROM businesses") && s.includes("ORDER BY created_at ASC")) {
        const match = t.businesses
          .filter((b) => String(b.workspace_id) === String(p[0]) && !b.archived)
          .sort((a, b2) => String(a.created_at).localeCompare(String(b2.created_at)))[0];
        return { rows: match ? [{ id: match.id }] : [] };
      }
      if (s.includes("FROM obligations o") && s.includes("JOIN businesses b")) {
        const rows = t.obligations
          .filter((o) => {
            const b = t.businesses.find((x) => String(x.id) === String(o.business_id));
            return b && String(b.workspace_id) === String(p[0]) && !b.archived;
          })
          .map((o) => {
            const b = t.businesses.find((x) => String(x.id) === String(o.business_id))!;
            return {
              id: o.id,
              name: o.name,
              agency: o.agency ?? null,
              status: o.status,
              due_date: (o.due_date as string | null) ?? null,
              due_date_source: (o.due_date_source as string | null) ?? null,
              renewal_frequency_months: (o.renewal_frequency_months as number | null) ?? null,
              updated_at: (o.updated_at as string | null) ?? null,
              requirement_id: (o.requirement_id as string | null) ?? null,
              next_action: (o.next_action as string | null) ?? null,
              source_reference: (o.source_reference as string | null) ?? null,
              mandatory: o.mandatory !== false,
              evidence_count: Number(o.evidence_count ?? 0),
              business_id: o.business_id,
              business_name: (b.legal_name as string) || (b.name as string),
              business_public_id: (b.public_id as string | null) ?? null,
              business_type: (b.business_type as string | null) ?? null,
              industry: (b.industry as string | null) ?? null,
              municipality: (b.municipality as string | null) ?? null,
              business_structure: (b.business_structure as string | null) ?? null,
            };
          });
        return { rows };
      }
      if (s.includes("FROM regulatory_developments d")) {
        const rows = t.developments.filter(
          (d) =>
            d.review_status === "verified" &&
            !t.shows.some((x) => String(x.development_id) === String(d.id) && String(x.workspace_id) === String(p[0]))
        );
        return { rows };
      }
      if (s.includes("INSERT INTO regulatory_development_shows")) {
        const exists = t.shows.some((x) => String(x.development_id) === String(p[0]) && String(x.workspace_id) === String(p[1]));
        if (!exists) t.shows.push({ development_id: p[0], workspace_id: p[1], period: p[2] });
        return { rows: [], rowCount: exists ? 0 : 1 };
      }
      if (s.includes("FROM auth.users")) {
        const u = t.users[String(p[0])];
        if (s.includes("raw_user_meta_data->>'lang'")) return { rows: [{ lang: u?.lang || null }] };
        if (s.includes("full_name")) return { rows: [{ name: u?.name || null }] };
        return { rows: [{ email: u?.email || null }] };
      }
      if (s.includes("INSERT INTO compliance_digest_log")) {
        const exists = t.digestLog.some((l) => String(l.workspace_id) === String(p[0]) && String(l.period) === String(p[2]));
        if (exists) return { rows: [], rowCount: 0 };
        t.digestLog.push({ workspace_id: p[0], user_id: p[1], period: p[2], item_count: p[3] });
        return { rows: [], rowCount: 1 };
      }
      if (s.includes("INSERT INTO email_templates")) {
        // Emulates ON CONFLICT (key, lang) DO NOTHING: never overwrites.
        const exists = t.templates.some((x) => String(x.key) === String(p[0]) && String(x.lang) === String(p[1]));
        if (!exists) {
          t.templates.push({
            key: p[0], lang: p[1], subject: p[2], html_template: p[3],
            text_template: p[4], variables: JSON.parse(String(p[5])),
            updated_at: "2026-09-14T00:00:00Z", updated_by: "seed",
          });
        }
        return { rows: [], rowCount: exists ? 0 : 1 };
      }
      if (s.includes("FROM email_templates")) {
        const row = t.templates.find((x) => String(x.key) === String(p[0]) && String(x.lang) === String(p[1]));
        return { rows: row ? [row] : [] };
      }
      if (s.includes("INSERT INTO email_archive")) {
        t.archive.push({
          template_key: p[0], lang: p[1], template_source: p[2], template_updated_at: p[3],
          recipient_user_id: p[4], workspace_id: p[5], recipient_email: p[6],
          subject: p[7], html_body: p[8], text_body: p[9],
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unhandled query in fake db: ${s.slice(0, 120)}`);
    },
  };
}

const FIRST_OF_OCT = new Date("2026-10-01T12:00:00Z");

test("cron sends the new digest: sections, branding, matched development", async () => {
  const sent: Row[] = [];
  setComplianceMailerForTests({ sendMail: async (opts) => { sent.push(opts as Row); return {}; } });
  try {
    const t = baseTables();
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 1);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].from), /alerts@getsmartpr\.com/);
    assert.match(String(sent[0].subject), /Monthly Compliance Digest/);
    const html = String(sent[0].html);
    // New sections.
    for (const title of ["Action required", "Coming up", "What changed", "SmartPR needs from you", "Compliance health"]) {
      assert.ok(html.includes(title), title);
    }
    // Branding.
    assert.ok(html.includes("#f4f1ea") && html.includes("#245c5c") && html.includes("IBM Plex Sans"));
    // Action items: o1 (due 10d) with what/why/risk + CTA; o3 stalled.
    assert.ok(html.includes("Patente Municipal"));
    assert.ok(html.includes("Review Requirement"));
    assert.ok(html.includes("What needs to happen"));
    assert.ok(html.includes("Permiso Único"));
    // Coming up: o2 (45d).
    assert.ok(html.includes("Merchant Registration"));
    // WHAT CHANGED: d1 matched via DOC_PERMISO_UNICO; d2 unverified excluded; d3 unmatched excluded.
    assert.ok(html.includes("OGPe updates Permiso Único renewal"));
    assert.ok(!html.includes("Unverified rumor"));
    assert.ok(!html.includes("Fishing license change"));
    // Needs from you: o4 (date), o5 (info).
    assert.ok(html.includes("Bomberos Cert"));
    assert.ok(html.includes("Mystery requirement"));
    // Health + compliance center CTA.
    assert.ok(html.includes("Open Compliance Center"));
    assert.ok(!html.includes("Done already"), "completed obligations excluded");
    // Shown developments recorded → next period won't repeat d1.
    assert.ok(t.shows.some((x) => String(x.development_id) === "d1"));
    // Idempotency: same month, no resend.
    const s2 = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s2.digests_sent, 0);
    assert.equal(s2.skipped_already_sent, 1);
    assert.equal(sent.length, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron skips free workspaces", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.subscriptions["w-op"] = "free";
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 0);
    assert.equal(s.skipped_plan, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron honors the digest-only opt-out", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.prefs.push({ user_id: "u1", scope: "digest", business_id: null, obligation_id: null, muted: true });
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 0);
    assert.equal(s.skipped_optout, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron on core covers only the oldest business", async () => {
  const sent: Row[] = [];
  setComplianceMailerForTests({ sendMail: async (opts) => { sent.push(opts as Row); return {}; } });
  try {
    const t = baseTables();
    t.subscriptions["w-op"] = "core";
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 1);
    const html = String(sent[0].html);
    assert.ok(html.includes("Patente Municipal"), "b1 item included");
    assert.ok(!html.includes("Bomberos Cert"), "b2-only item excluded on core");
    // Single-business header uses the business name.
    assert.match(String(sent[0].subject), /Café Luna/);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron skips workspaces with no active obligations", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.obligations = [];
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 0);
    assert.equal(s.skipped_empty, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("classifyObligation never invents dates: unknown-date items stay dateless", () => {
  const row: DigestObligationRow = {
    ...baseRow,
    id: "o9",
    status: "CURRENT",
    due_date: null,
    due_date_source: "UNKNOWN",
    renewal_frequency_months: 12,
  };
  const o = classifyObligation(row, { now: FIRST_OF_OCT, planId: "operator", coveredBusinessId: null, prefs: [] });
  assert.ok(o);
  assert.equal(o.daysRemaining, null);
  assert.equal(o.overdue, false);
});

test("DIGEST_CAPS keeps the email readable in under 2 minutes", () => {
  assert.ok(DIGEST_CAPS.action <= 10 && DIGEST_CAPS.coming <= 10 && DIGEST_CAPS.changes <= 6 && DIGEST_CAPS.needs <= 8);
});

test("cron uses the Supabase template when present and archives the send", async () => {
  const sent: Row[] = [];
  setComplianceMailerForTests({ sendMail: async (opts) => { sent.push(opts as Row); return {}; } });
  try {
    const t = baseTables();
    // A founder-customized wrapper already in the table.
    t.templates.push({
      key: "digest", lang: "en",
      subject: "CUSTOM-DIGEST {{business_label}}",
      html_template: "<html><body><h1>CUSTOM</h1>{{header}}{{action_required}}</body></html>",
      text_template: "CUSTOM {{text_header}}",
      variables: [], updated_at: "2026-09-13T00:00:00Z", updated_by: "darius@getsmartpr.com",
    });
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 1);
    assert.equal(sent.length, 1);
    // The stored wrapper rendered the send (not the built-in).
    assert.match(String(sent[0].subject), /^CUSTOM-DIGEST /);
    assert.ok(String(sent[0].html).includes("<h1>CUSTOM</h1>"));
    // Seeding did not overwrite the founder's edit.
    const row = t.templates.find((x) => x.key === "digest" && x.lang === "en");
    assert.equal(row?.updated_by, "darius@getsmartpr.com");
    // The send was archived with its template version.
    assert.equal(t.archive.length, 1);
    const a = t.archive[0];
    assert.equal(a.template_key, "digest");
    assert.equal(a.template_source, "db");
    assert.equal(a.template_updated_at, "2026-09-13T00:00:00Z");
    assert.equal(a.recipient_email, "owner@example.com");
    assert.equal(a.workspace_id, "w-op");
    assert.match(String(a.subject), /^CUSTOM-DIGEST /);
    assert.ok(String(a.html_body).includes("<h1>CUSTOM</h1>"));
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron falls back to the built-in wrapper and still archives when templates are missing", async () => {
  const sent: Row[] = [];
  setComplianceMailerForTests({ sendMail: async (opts) => { sent.push(opts as Row); return {}; } });
  try {
    const t = baseTables();
    // Simulate a DB where the SELECT finds nothing: drop the seed rows after seeding.
    const db = makeDb(t);
    const origQuery = db.query;
    db.query = (async (sql: string, params: unknown[] = []) => {
      const res = await (origQuery as (s: string, p?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }>)(
        sql, params
      );
      if (String(sql).includes("FROM email_templates")) return { rows: [], rowCount: 0 };
      return res;
    }) as typeof db.query;
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 1);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].subject), /Monthly Compliance Digest/);
    assert.equal(t.archive.length, 1);
    assert.equal(t.archive[0].template_source, "builtin");
    assert.equal(t.archive[0].template_updated_at, null);
  } finally {
    setComplianceMailerForTests(null);
  }
});
