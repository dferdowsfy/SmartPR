// Pure helpers for the ChatGPT handoff review screen (no React, unit-tested).

import type { NormalizedScenario } from "./assessment";
import type { HandoffIntent } from "./handoff";

/** Intake entry used after review. The guest draft written just before is
 *  restored by SmartPRIntake for guests and signed-in users alike. */
export const HANDOFF_INTAKE_PATH = "/?entry=new-business&source=chatgpt";

/** Which buttons the review screen shows for an intent + auth state. */
export function handoffActions(intent: HandoffIntent, signedIn: boolean): { primary: string; signIn: "primary" | "secondary" | null } {
  if (signedIn) return { primary: intent === "use_plan" ? "Continue with my SmartPR plan" : intent === "unlock" ? "Continue to full assessment" : "Review in SmartPR intake", signIn: null };
  if (intent === "use_plan") return { primary: "Continue without signing in", signIn: "primary" };
  if (intent === "unlock") return { primary: "Continue to full assessment", signIn: "secondary" };
  return { primary: "Review in SmartPR intake", signIn: "secondary" };
}

export function scenarioToGuestDraft(s: NormalizedScenario) {
  const profile: Record<string, unknown> = {};
  if (s.business_type) profile.business_type = s.business_type;
  if (s.municipality) profile.municipality = s.municipality;
  if (s.business_status !== "unknown") profile.business_stage = s.business_status;
  if (s.employees != null) profile.number_of_employees = s.employees;
  if (s.activity_description) profile.description = s.activity_description;
  // A ChatGPT map pin becomes the intake's confirmed site (same shape the
  // portal pin produces); the intake then loads zoning/flood/parcel for it.
  const intakeSite = s.site
    ? {
        latitude: s.site.latitude, longitude: s.site.longitude, coordinate_source: "MAP_PIN", formatted_address: null,
        municipality: { name: s.site.municipality, fips: s.site.fips }, barrio: s.site.barrio ? { name: s.site.barrio, geoid: s.site.barrio_geoid } : null,
        near_boundary: s.site.near_boundary, designations: s.site.designations, boundary_source: null, location_id: null, confirmed_at: new Date().toISOString(),
      }
    : undefined;
  return { profile, discoveryAnswers: { ...s.answers }, potentialDecisions: {}, ...(intakeSite ? { intakeSite } : {}), currentStep: 1, language: "en" };
}
