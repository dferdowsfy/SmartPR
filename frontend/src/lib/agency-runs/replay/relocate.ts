/**
 * Strict replay, selector drift: re-locating ONE recorded control.
 *
 * The replay engine follows the recorded steps exactly. When a recorded
 * control can't be found (the portal renamed "Nombre del negocio" to
 * "Nombre legal del negocio", or its id changed), the engine may ask a
 * relocator to pick the same control among the labels the page shows.
 * The relocator only ever names one of those visible labels — or nothing,
 * in which case Clara pauses, says what she sees and offers Re-teach. It
 * never adds steps, never picks a submit control and never sees values.
 *
 *  - fuzzyRelocate: deterministic token overlap; one clear winner or null.
 *  - agentRelocator: asks the model (labels only) when fuzzy matching finds
 *    nothing; its answer must be one of the visible labels verbatim.
 */
import { isSubmitTarget } from "../skills/skillValidate";
import { normalizeLabel } from "../teach/passportCatalog";

export type Relocator = (target: { role: string; label: string; selector?: string | null }, seen: string[]) => Promise<string | null>;

const STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "en", "a", "the", "of", "and", "or", "your", "su", "tu"]);

function tokens(s: string): string[] {
  return normalizeLabel(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export function labelSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

function safeCandidate(role: string, label: string): boolean {
  return !isSubmitTarget({ role: role === "option" ? "option" : role === "combobox" ? "combobox" : "button", label_contains: label, selector: null });
}

/** One clear match (≥ 0.6 overlap, ≥ 0.2 ahead of the next) or null. */
export function fuzzyRelocate(target: { role: string; label: string }, seen: string[]): string | null {
  const scored = [...new Set(seen.map((s) => s.trim()).filter(Boolean))]
    .filter((s) => safeCandidate(target.role, s))
    .map((s) => ({ s, score: labelSimilarity(target.label, s) }))
    .sort((x, y) => y.score - x.score);
  const [best, next] = scored;
  if (!best || best.score < 0.6) return null;
  if (next && best.score - next.score < 0.2) return null;
  return best.s;
}

export type LabelPicker = (prompt: { system: string; user: string }) => Promise<string>;

/** fuzzyRelocate first; then (optionally) the agent, constrained to the visible labels. */
export function agentRelocator(pick: LabelPicker | null): Relocator {
  return async (target, seen) => {
    const fuzzy = fuzzyRelocate(target, seen);
    if (fuzzy) return fuzzy;
    if (!pick || !seen.length) return null;
    const options = [...new Set(seen.map((s) => s.trim()).filter(Boolean))].slice(0, 25);
    try {
      const raw = await pick({
        system:
          "A government portal changed slightly. Pick the ONE visible control that is the same control as the recorded one, or reply NONE. Reply with the label exactly as listed, nothing else. Never pick a submit/send/pay button.",
        user: `Recorded ${target.role}: "${target.label}"\nVisible controls:\n${options.map((o) => `- ${o}`).join("\n")}`,
      });
      const answer = raw.trim().replace(/^["“]|["”]$/g, "");
      const hit = options.find((o) => o === answer);
      return hit && safeCandidate(target.role, hit) ? hit : null;
    } catch {
      return null;
    }
  };
}
