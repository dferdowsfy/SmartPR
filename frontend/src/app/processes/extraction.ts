// KB-driven intake extraction: facts declared in any process pack with an
// `extraction` hint are (1) described to the intake model in the
// interpretation prompt (EN/ES) and (2) accepted by the project-context
// validator with the KB's type, options and unit. Adding a fact to a pack
// therefore needs no prompt or validator code change.
import { PROCESS_PACKS } from "./kb.ts";
import type { FactDefinition } from "./types.ts";

let cache: Map<string, FactDefinition> | null = null;

/** Every KB fact definition across packs (first declaration wins). */
export function kbFactDefinitions(): Map<string, FactDefinition> {
  if (cache) return cache;
  cache = new Map();
  for (const pack of PROCESS_PACKS) for (const f of pack.facts) if (!cache.has(f.key)) cache.set(f.key, f);
  return cache;
}

/** Facts the intake model may extract because the KB gives it a hint. */
export function kbExtractableFacts(): FactDefinition[] {
  return [...kbFactDefinitions().values()].filter((f) => !!f.extraction);
}

/** Prompt lines for the KB-declared facts (one "- …" line per fact). */
export function kbExtractionPromptLines(lang: "en" | "es"): string {
  return kbExtractableFacts()
    .map((f) => `- ${f.extraction![lang]}`)
    .join("\n");
}

/** Normalize a stated number to the fact's unit; null when not numeric. */
export function toFactUnit(def: FactDefinition, raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n) || String(raw ?? "").trim() === "") return null;
  if (typeof raw !== "string") return n;
  if (def.unit === "kW" && /(\d|\s)mw\b|megawatt/i.test(raw)) return n * 1000;
  if (def.unit === "MWh" && /(\d|\s)kwh\b|kilowatt[\s-]*hour/i.test(raw)) return n / 1000;
  if (def.unit === "ft" && /(\d|\s)(m|meters?|metros?)\b/i.test(raw) && !/\bft\b|feet|pies/i.test(raw)) return Math.round(n * 3.28084);
  return n;
}

/** Short chip label for a KB fact value (null = no chip). */
export function kbFactChipLabel(key: string, value: string | number | boolean): string | null {
  const def = kbFactDefinitions().get(key);
  const chip = def?.chip;
  if (!chip) return null;
  const mapped = chip.values?.[String(value)];
  if (mapped) return mapped;
  if (!chip.template) return null;
  const shown = typeof value === "number" ? value.toLocaleString("en-US") : String(value);
  return chip.template.replace("{value}", shown);
}
