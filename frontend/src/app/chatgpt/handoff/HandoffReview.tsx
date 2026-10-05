"use client";

import { saveGuestDraft } from "../../../lib/guestDraft";
import type { NormalizedScenario } from "../../../lib/chatgpt/assessment";
import type { HandoffIntent } from "../../../lib/chatgpt/handoff";
import { HANDOFF_INTAKE_PATH, handoffActions, scenarioToGuestDraft } from "../../../lib/chatgpt/handoffActions";

export default function HandoffReview({ scenario, intent, expiresAt, selfPath, signedIn = false }: { scenario: NormalizedScenario; intent: HandoffIntent; expiresAt: string; selfPath: string; signedIn?: boolean }) {
  const rows: Array<[string, string]> = [
    ["Activity", scenario.business_type || (scenario.business_type_input ? `${scenario.business_type_input} (to confirm)` : "Not provided")],
    ["Municipality", scenario.municipality || "Not provided"],
    ["Site (map pin)", scenario.site ? `${scenario.site.barrio ? `${scenario.site.barrio}, ` : ""}${scenario.site.municipality} · ${scenario.site.latitude.toFixed(5)}, ${scenario.site.longitude.toFixed(5)}${scenario.site.near_boundary ? " (near a boundary — confirm)" : ""}` : "Not pinned"],
    ["Registration status", scenario.business_status === "unknown" ? "Not confirmed" : scenario.business_status === "existing" ? "Already registered" : "Not yet registered"],
    ["Premises", scenario.square_feet != null ? `${scenario.square_feet.toLocaleString("en-US")} sq ft` : "Not provided"],
    ["Employees", scenario.employees != null ? String(scenario.employees) : "Not provided"],
    ["Renovation", scenario.renovation === "unknown" ? "Not confirmed" : scenario.renovation],
  ];
  const answered = Object.keys(scenario.answers || {}).length;
  function proceed() {
    saveGuestDraft(scenarioToGuestDraft(scenario));
    window.location.assign(HANDOFF_INTAKE_PATH);
  }
  const { primary, signIn } = handoffActions(intent, signedIn);
  const loginHref = `/auth/login?next=${encodeURIComponent(selfPath)}`;
  const btn = { borderRadius: 8, padding: "10px 16px", fontWeight: 600, cursor: "pointer", fontSize: 15 } as const;
  const solid = { ...btn, background: "#0f766e", color: "#fff", border: "1px solid #0f766e", textDecoration: "none" } as const;
  const outline = { ...btn, background: "#fff", color: "#115e59", border: "1px solid #0f766e", textDecoration: "none" } as const;
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
        {signIn === "primary" && <a href={loginHref} style={solid}>Sign in to use my plan</a>}
        <button type="button" onClick={proceed} style={signIn === "primary" ? outline : solid}>{primary}</button>
        {signIn === "secondary" && <a href={loginHref} style={outline}>Sign in or create an account</a>}
        {intent === "unlock" && <a href="/pricing" style={outline}>See plans</a>}
      </div>
      {signedIn && <p style={{ color: "#64748b", fontSize: 13, marginTop: 10 }}>You&apos;re signed in — the scenario will open in your account&apos;s intake.</p>}
      <p style={{ color: "#64748b", fontSize: 12, marginTop: 16 }}>Link expires {new Date(expiresAt).toLocaleString()}. Preliminary triage, not legal advice.</p>
    </section>
  );
}
