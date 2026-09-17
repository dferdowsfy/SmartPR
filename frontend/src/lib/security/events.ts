/**
 * Security event taxonomy — normalize where feasible without breaking compat.
 * Existing audit action strings remain valid; prefer TAXONOMY keys for new writes.
 */

export const SECURITY_EVENT_TAXONOMY = {
  // Support access
  "support_access.granted": { category: "support_access", severity: "medium" },
  "support_access.revoked": { category: "support_access", severity: "medium" },
  "support_access.used": { category: "support_access", severity: "low" },
  "support_access.expired": { category: "support_access", severity: "low" },

  // Service accounts
  "integrations.service_account_created": { category: "service_account", severity: "medium" },
  "integrations.service_account_rotated": { category: "service_account", severity: "medium" },
  "integrations.service_account_revoked": { category: "service_account", severity: "medium" },

  // Auth / SSO / SCIM
  "security.sso_tested": { category: "sso", severity: "low" },
  "security.enforcement_changed": { category: "sso", severity: "high" },
  "scim.user_created": { category: "scim", severity: "medium" },
  "scim.user_updated": { category: "scim", severity: "low" },
  "scim.user_deactivated": { category: "scim", severity: "medium" },
  "scim.group_updated": { category: "scim", severity: "low" },

  // Readiness modules
  "security.evidence_recorded": { category: "evidence", severity: "low" },
  "security.evidence_updated": { category: "evidence", severity: "low" },
  "security.incident_created": { category: "incident", severity: "high" },
  "security.incident_updated": { category: "incident", severity: "medium" },
  "security.risk_created": { category: "risk", severity: "medium" },
  "security.risk_updated": { category: "risk", severity: "low" },
  "security.policy_recorded": { category: "policy", severity: "low" },
  "security.access_review_recorded": { category: "access_review", severity: "medium" },
  "security.plaintext_secret_detected": { category: "secrets", severity: "high" },
} as const;

export type SecurityEventAction = keyof typeof SECURITY_EVENT_TAXONOMY;

/** Legacy aliases → preferred taxonomy action (compat layer). */
const ALIASES: Record<string, SecurityEventAction> = {
  "support.granted": "support_access.granted",
  "support.revoked": "support_access.revoked",
};

export function normalizeSecurityAction(action: string): string {
  if (action in SECURITY_EVENT_TAXONOMY) return action;
  if (ALIASES[action]) return ALIASES[action];
  return action; // preserve unknown for backward compatibility
}

export function getEventMeta(action: string): { category: string; severity: string } | null {
  const normalized = normalizeSecurityAction(action);
  const meta = SECURITY_EVENT_TAXONOMY[normalized as SecurityEventAction];
  return meta ?? null;
}

export function isKnownSecurityAction(action: string): boolean {
  const n = normalizeSecurityAction(action);
  return n in SECURITY_EVENT_TAXONOMY;
}
