// Short agency names for the checklist view ("Departamento de Hacienda" →
// "Hacienda"), from kb/agencies.json `short_name` (matched by name or alias).
import agencies from "../../../kb/agencies.json";

type Agency = { id: string; name: string; aliases?: string[]; short_name?: string };
const index = new Map<string, string>();
for (const a of agencies as Agency[]) {
  if (!a.short_name) continue;
  for (const n of [a.id, a.name, ...(a.aliases ?? [])]) index.set(n.trim().toLowerCase(), a.short_name);
}

export function shortAgencyName(name: string | null | undefined): string | null {
  if (!name) return null;
  return index.get(name.trim().toLowerCase()) ?? name;
}
