// ============================================================================
// Enterprise feature gates for third-party egress.
//
// Each gate covers an integration that sends customer data, or telemetry about
// customer users, to a vendor outside the customer's environment.
//
// Standard: every gate is open (unchanged behaviour).
// Enterprise: every gate is CLOSED unless explicitly approved with
//   ENTERPRISE_ALLOW_<FEATURE>=true
// An invalid deployment config is treated as Enterprise (fail closed).
//
// Pure apart from reading the env object passed in. Reads config per call so a
// gate can never be cached open.
// ============================================================================

import { loadDeploymentConfig } from "./deployment";

type Env = Record<string, string | undefined>;

export const EGRESS_FEATURES = {
  /** xAI realtime phone agent: call audio + MCP callbacks to xAI. */
  voiceTelephony: "ENTERPRISE_ALLOW_VOICE_TELEPHONY",
  /** Browser Use Cloud: filing data and page content to Browser Use. */
  browserUseCloud: "ENTERPRISE_ALLOW_BROWSER_USE_CLOUD",
  /** Google Analytics in the browser. */
  browserAnalytics: "ENTERPRISE_ALLOW_BROWSER_ANALYTICS",
  /** Stripe billing (customer email, plan data). */
  billing: "ENTERPRISE_ALLOW_BILLING",
  /** Outbound email via Gmail SMTP / Resend (notification content). */
  externalEmail: "ENTERPRISE_ALLOW_EXTERNAL_EMAIL",
} as const;

export type EgressFeature = keyof typeof EGRESS_FEATURES;

function isStandard(env: Env): boolean {
  try {
    return loadDeploymentConfig(env).mode === "standard";
  } catch {
    return false; // invalid config → Enterprise rules
  }
}

export function isFeatureEnabled(feature: EgressFeature, env: Env = process.env): boolean {
  if (isStandard(env)) return true;
  return env[EGRESS_FEATURES[feature]]?.trim().toLowerCase() === "true";
}

export class FeatureDisabledError extends Error {
  constructor(public readonly feature: EgressFeature) {
    super(
      `${feature} is disabled in this Enterprise deployment. ` +
        `It requires customer approval and ${EGRESS_FEATURES[feature]}=true.`
    );
    this.name = "FeatureDisabledError";
  }
}

export function assertFeatureEnabled(feature: EgressFeature, env: Env = process.env): void {
  if (!isFeatureEnabled(feature, env)) throw new FeatureDisabledError(feature);
}

/** Uniform response for HTTP entry points of a disabled feature. */
export function featureDisabledResponse(feature: EgressFeature): Response {
  return Response.json({ error: "feature_disabled", feature }, { status: 404 });
}

let warned = new Set<EgressFeature>();

/** Logs once per feature when a disabled integration is skipped. */
export function logFeatureSkipped(feature: EgressFeature, where: string): void {
  if (warned.has(feature)) return;
  warned.add(feature);
  console.warn(`[features] ${where}: ${feature} disabled in Enterprise deployment; skipped.`);
}

/** Test seam. */
export function resetFeatureWarningsForTests(): void {
  warned = new Set();
}
