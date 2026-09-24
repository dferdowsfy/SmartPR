/**
 * Field-level helpers for the sensitive-value lifecycle in the assistant
 * panel: identify sensitive fields, keep their retained values sealed, and
 * unseal them only transiently for the single fill POST.
 *
 * Invariants:
 * - `fieldValues` / retained maps hold plaintext for non-sensitive fields and
 *   SealedSensitiveValue envelopes for sensitive ones — never sensitive
 *   plaintext at rest.
 * - Plaintext exists only (a) inside the input element while typing, (b) in a
 *   transient local decrypted for the eye-icon reveal, or (c) in the
 *   short-lived map built for one resume POST.
 */
import {
  isSealedSensitiveValue,
  sealSensitiveValue,
  unsealSensitiveValue,
  type SealedSensitiveValue,
} from "./sensitiveCrypto";
import type { AgencyPendingField } from "./types";

export type { SealedSensitiveValue };

/** A retained assistant-panel value: plaintext or a sealed envelope. */
export type FieldValue = string | SealedSensitiveValue;

/**
 * Central definition of "sensitive field" — mirrors what the UI has always
 * treated as masked (explicit sensitive flag or password input).
 */
export function isSensitiveField(
  field: { sensitive?: boolean; type?: string } | null | undefined
): boolean {
  if (!field) return false;
  return field.sensitive === true || field.type === "password";
}

/**
 * True when the entry represents user-typed content — non-empty plaintext or
 * a sealed envelope. Used for required-field completeness checks.
 */
export function fieldValuePresent(
  v: FieldValue | undefined | null
): boolean {
  if (v == null) return false;
  if (isSealedSensitiveValue(v)) return true;
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Seal the sensitive entries of a plaintext map (e.g. before retaining
 * submitted values for a later re-ask). Non-sensitive values pass through.
 * Empty values are dropped.
 */
export async function sealFieldEntries(
  entries: Record<string, string>,
  isSensitiveId: (id: string) => boolean
): Promise<Record<string, FieldValue>> {
  const out: Record<string, FieldValue> = {};
  for (const [id, val] of Object.entries(entries ?? {})) {
    if (typeof val !== "string" || !val.trim()) continue;
    out[id] = isSensitiveId(id) ? await sealSensitiveValue(val) : val;
  }
  return out;
}

/**
 * Unseal a retained map back to plaintext for exactly one use (the fill
 * POST). Callers must drop the returned map as soon as the POST resolves.
 */
export async function unsealFieldEntries(
  entries: Record<string, FieldValue> | null | undefined
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!entries || typeof entries !== "object") return out;
  for (const [id, v] of Object.entries(entries)) {
    if (isSealedSensitiveValue(v)) {
      const plain = await unsealSensitiveValue(v);
      if (plain.trim()) out[id] = plain;
    } else if (typeof v === "string" && v.trim()) {
      out[id] = v;
    }
  }
  return out;
}

/**
 * Assert that a retained map carries no sensitive plaintext — every
 * sensitive id must hold a sealed envelope (or nothing). Throws naming the
 * offending id. Used by tests and debug guards; never ships values anywhere.
 */
export function assertNoSensitivePlaintext(
  entries: Record<string, FieldValue> | null | undefined,
  isSensitiveId: (id: string) => boolean
): void {
  if (!entries || typeof entries !== "object") return;
  for (const [id, v] of Object.entries(entries)) {
    if (isSensitiveId(id) && typeof v === "string" && v.trim()) {
      throw new Error(
        `sensitive plaintext at rest for field "${id}" — seal it before retaining`
      );
    }
  }
}
