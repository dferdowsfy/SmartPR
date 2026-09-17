/**
 * Load and query the security control registry (JSON + typed helpers).
 * Server-safe; do not treat status as a SOC 2 score.
 */
import type { SecurityControl, SecurityControlsRegistry, ControlStatus } from "./types";
import registryJson from "./security_controls.json";

const registry = registryJson as SecurityControlsRegistry;

export function getSecurityControlsRegistry(): SecurityControlsRegistry {
  return registry;
}

export function listSecurityControls(): SecurityControl[] {
  return [...registry.controls];
}

export function getSecurityControl(id: string): SecurityControl | undefined {
  return registry.controls.find((c) => c.id === id);
}

export function countControlsByStatus(): Record<ControlStatus, number> {
  const counts: Record<ControlStatus, number> = {
    implemented: 0,
    partial: 0,
    documented_only: 0,
    missing: 0,
    requires_verification: 0,
  };
  for (const c of registry.controls) {
    counts[c.status] = (counts[c.status] ?? 0) + 1;
  }
  return counts;
}

/** Factual summary only — never a "SOC 2 score". */
export function controlInventorySummary(): {
  total: number;
  by_status: Record<ControlStatus, number>;
  disclaimer: string;
} {
  return {
    total: registry.controls.length,
    by_status: countControlsByStatus(),
    disclaimer: registry.disclaimer,
  };
}
