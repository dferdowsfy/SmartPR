/**
 * What a deterministic derivation may settle an intake question FROM.
 *
 * Run 18 (live 2026-10-17, Las Marías barbershop): the description said "two
 * chairs", the interpreter filled "2 employees" at mid confidence and flagged
 * it "Needs confirmation". The resolver derived "Will employees be hired? —
 * Yes" from that flagged headcount and the intake showed it as already
 * settled, so it was never asked. The engine, under strict provenance, treats
 * the flagged headcount as inert, so the derived Yes was inert too: CFSE,
 * DTRH and SURI withholding silently disappeared while the page said the
 * question was settled.
 *
 * A question is only settled by a derivation whose sources the engine will
 * also accept. Flagged ("Needs confirmation") keys are therefore left out of
 * the facts used to decide what is already settled. The flagged value itself
 * stays visible with its badge, and the derived question is asked instead,
 * so the user's own answer establishes it.
 */
import { questionIdForAnswerKey } from "./questionKeyMap.ts";

export function withoutUnconfirmedSources<P extends object, A extends Record<string, unknown>>(
  profile: P,
  answers: A,
  confirmationsNeeded: Readonly<Record<string, boolean>>
): { profile: P; answers: A } {
  const flagged = Object.keys(confirmationsNeeded).filter((k) => confirmationsNeeded[k]);
  if (flagged.length === 0) return { profile, answers };
  const flaggedSet = new Set(flagged);
  const isFlagged = (key: string): boolean => {
    if (flaggedSet.has(key)) return true;
    const qid = questionIdForAnswerKey(key);
    return !!qid && flaggedSet.has(qid);
  };
  const p = { ...(profile as Record<string, unknown>) };
  for (const k of Object.keys(p)) if (isFlagged(k)) p[k] = null;
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) if (!isFlagged(k)) a[k] = v;
  return { profile: p as P, answers: a as A };
}
