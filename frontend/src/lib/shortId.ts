import { randomBytes } from "crypto";

// Short, URL-friendly public ids for businesses (e.g. /businesses/k7d2mq9x).
// The alphabet skips ambiguous characters (0/O, 1/l) so ids stay readable
// when shared or read aloud.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateShortId(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** A raw path/query param is already a short public id (not a UUID). */
export function looksLikeShortId(value: string | null | undefined): boolean {
  return !!value && value.length <= 16 && !value.includes("-");
}
