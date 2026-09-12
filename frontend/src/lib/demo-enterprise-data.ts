// ============================================================================
// Enterprise demo fixtures — CLIENT-SAFE pure data.
//
// DEMO_USERS / DEMO_FACILITIES are rendered by the client demo page
// (src/app/demo/enterprise/page.tsx, "use client"). This module must stay
// free of server-only imports (pg, node:crypto, ../app/graph/db): the
// seeding logic lives in ./demo-enterprise-seed.ts, which re-exports these
// constants for server use.
// ============================================================================

import type { RoleKey } from "./enterprise-permissions";

export interface DemoUserDef {
  roleKey: RoleKey;
  name: string;
  email: string;
  legacyRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

/** Fictional demo users — illustrative only; they have no auth accounts. */
export const DEMO_USERS: DemoUserDef[] = [
  { roleKey: "org_owner", name: "Ada Dueña (Demo)", email: "demo-owner@caribe-industrial.demo", legacyRole: "OWNER" },
  { roleKey: "compliance_manager", name: "María Vélez (Demo)", email: "demo-manager@caribe-industrial.demo", legacyRole: "ADMIN" },
  { roleKey: "facility_manager", name: "José Rivera (Demo)", email: "demo-facility@caribe-industrial.demo", legacyRole: "MEMBER" },
  { roleKey: "contributor", name: "Ana Torres (Demo)", email: "demo-contributor@caribe-industrial.demo", legacyRole: "MEMBER" },
  { roleKey: "evidence_reviewer", name: "Luis Méndez (Demo)", email: "demo-reviewer@caribe-industrial.demo", legacyRole: "MEMBER" },
  { roleKey: "auditor", name: "Carmen Ortiz (Demo)", email: "demo-auditor@caribe-industrial.demo", legacyRole: "VIEWER" },
];

/** Fictional facilities (names/addresses are invented; municipalities are real). */
export const DEMO_FACILITIES = [
  { name: "Oficinas Centrales (Demo)", municipality: "San Juan", address: "123 Avenida Demo, San Juan, PR 00901" },
  { name: "Planta Norte (Demo)", municipality: "Bayamón", address: "456 Carretera Demo, Bayamón, PR 00956" },
  { name: "Almacén Este (Demo)", municipality: "Guaynabo", address: "789 Calle Demo, Guaynabo, PR 00969" },
  { name: "Centro de Distribución (Demo)", municipality: "Carolina", address: "1010 Ruta Demo, Carolina, PR 00982" },
  { name: "Planta Sur (Demo)", municipality: "Ponce", address: "1112 Camino Demo, Ponce, PR 00716" },
];
