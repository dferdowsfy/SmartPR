/**
 * Phone number normalization for SmartPR voice access.
 *
 * Canonical form is E.164 (e.g. +17875550142). Puerto Rico uses the North
 * American Numbering Plan (+1), so a 10-digit national number is assumed to
 * be NANP unless an explicit country code is present.
 *
 * This is intentionally a small, dependency-free normalizer rather than a
 * full libphonenumber port: voice access only needs a stable, canonical
 * caller-ID key for lookup, not carrier validation.
 */

export interface NormalizedPhone {
  /** Canonical E.164 form, e.g. "+17875550142". Used as the lookup key. */
  e164: string;
  /** Human-friendly display form, e.g. "(787) 555-0142". */
  display: string;
}

/**
 * Normalize a raw phone input to E.164. Returns null when the input cannot
 * be interpreted as a dialable number.
 */
export function normalizePhone(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let e164Digits: string;
  if (hasPlus) {
    // Explicit country code — trust it, require a plausible length.
    if (digits.length < 8 || digits.length > 15) return null;
    e164Digits = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    // NANP with trunk "1" prefix.
    e164Digits = digits;
  } else if (digits.length === 10) {
    // NANP national number (US / Puerto Rico / etc.).
    e164Digits = `1${digits}`;
  } else {
    return null;
  }

  const e164 = `+${e164Digits}`;
  return { e164, display: displayPhone(e164) };
}

/** Format an E.164 number for display. NANP numbers get (XXX) XXX-XXXX. */
export function displayPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const area = digits.slice(1, 4);
    const mid = digits.slice(4, 7);
    const last = digits.slice(7);
    return `(${area}) ${mid}-${last}`;
  }
  return e164;
}

/** True when two phone inputs refer to the same canonical number. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return Boolean(na && nb && na.e164 === nb.e164);
}
