"use client";

import { saveGuestDraft } from "../../../lib/guestDraft";
import type { NormalizedScenario } from "../../../lib/chatgpt/assessment";
import type { HandoffIntent } from "../../../lib/chatgpt/handoff";

export function scenarioToGuestDraft(s: NormalizedScenario) {
  const profile: Record<string, unknown> = {};
  if (s.business_type) profile.business_type = s.business_type;
  if (s.municipality) profile.municipality = s.municipality;
  if (s.business_status !== "unknown") profile.business_stage = s.business_status;
  if (s.employees != null) profile.number_of_employees = s.employees;
  if (s.activity_description) profile.description = s.activity_description;
  return { profile, discoveryAnswers: { ...s.answers }, potentialDecisions: {}, currentStep: 1, language: "en" };
}

export default function HandoffReview({ scenario, intent, expiresAt, selfPath }: { scenario: NormalizedScenario; intent: HandoffIntent; expiresAt: string; selfPath: string }) {
  const rows: Array<[string, string]> = [
    ["Activity", scenario.business_type || (scenario.business_type_input ? `${scenario.business_type_input} (to confirm)` : "Not provided")],
    ["Municipality", scenario.municipality || "Not provided"],
    ["Registration status", scenario.business_status === "unknown" ? "Not confirmed" : scenario.business_status === "existing" ? "Already registered" : "Not yet registered"],
    ["Premises", scenario.square_feet != null ? `${scenario.square_feet.toLocaleString("en-US")} sq ft` : "Not provided"],
    ["Employees", scenario.employees != null ? String(scenario.employees) : "Not provided"],
    ["Renovation", scenario.renovation === "unknown" ? "Not confirmed" : scenario.renovation],
  ];
  const answered = Object.keys(scenario.answers || {}).length;
  function proceed() {
    saveGuestDraft(scenarioToGuestDraft(scenario));
    window.location.assign("/?entry=new-business&source=chatgpt");
  }
  const btn = { borderRadius: 8, padding: "10px 16px", fontWeight: 600, cursor: "pointer", fontSize: 15 } as const;
  return (
    <section>
      <p style={{ color: "#64748b" }}>
        These are the details you shared in ChatGPT. Nothing has been saved to SmartPR. Review them, then continue — you&apos;ll confirm each step in the intake before any business, passport or filing is created.
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}><dt style={{ color: "#64748b" }}>{k}</dt><dd style={{ margin: 0, fontWeight: 500 }}>{v}</dd></div>
        ))}
        <dt style={{ color: "#64748b" }}>Clarifying answers</dt><dd style={{ margin: 0 }}>{answered}</dd>
      </dl>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
        <button type="button" onClick={proceed} style={{ ...btn, background: "#0f766e", color: "#fff", border: "1px solid #0f766e" }}>Review in SmartPR intake</button>
        {intent !== "continue" && (
          <a href={`/auth/login?next=${encodeURIComponent(selfPath)}`} style={{ ...btn, color: "#115e59", border: "1px solid #0f766e", textDecoration: "none" }}>Sign in to use my plan</a>
        )}
        {intent === "unlock" && (
          <a href="/pricing" style={{ ...btn, color: "#115e59", border: "1px solid #0f766e", textDecoration: "none" }}>See plans</a>
        )}
      </div>
      <p style={{ color: "#64748b", fontSize: 12, marginTop: 16 }}>Link expires {new Date(expiresAt).toLocaleString()}. Preliminary triage, not legal advice.</p>
    </section>
  );
}
