/**
 * Skills shipped in the repo (hand-written, reviewed in code review). They
 * belong to the shared library; like any shared skill they're only matched
 * for replay once their status is "approved".
 */
import ogpePermisoUnicoV1 from "./ogpe.permiso_unico.v1.json";
import type { Skill } from "./skill";

export const BUNDLED_SKILLS: Skill[] = [ogpePermisoUnicoV1 as Skill];

export function bundledRef(skill: Skill): string {
  return `bundled:${skill.skill_id}@${skill.version}`;
}

export function bundledSkill(ref: string): Skill | null {
  return BUNDLED_SKILLS.find((s) => bundledRef(s) === ref) ?? null;
}
