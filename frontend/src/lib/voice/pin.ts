/**
 * Voice access PIN handling.
 *
 * PINs are 6-digit numeric codes. They are NEVER stored in plaintext.
 * Hashing uses Node's built-in scrypt KDF (N=16384, r=8, p=1) with a
 * per-PIN random 16-byte salt. The stored envelope is:
 *
 *   scrypt$16384$8$1$<base64 salt>$<base64 derived key>
 *
 * Zero dependencies, constant-time verification via crypto.timingSafeEqual.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "crypto";

/** Promise wrapper around callback-style scrypt with our fixed cost parameters. */
function scryptKey(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, derived) => {
        if (err) reject(err);
        else resolve(derived as Buffer);
      }
    );
  });
}

const ENVELOPE_PREFIX = "scrypt";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export const PIN_LENGTH = 6;
export const MAX_PIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** True when the value is a syntactically valid 6-digit PIN. */
export function isValidPinFormat(pin: string | null | undefined): boolean {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

const DIGIT_WORDS: Record<string, string> = {
  // English
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  // Spanish
  cero: "0",
  uno: "1",
  una: "1",
  un: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
};

const DIGIT_WORD_RE =
  /\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi;

/**
 * Normalize caller-supplied PIN input to digits. Translates spoken digit
 * words (English and Spanish) to digits, then strips every remaining
 * non-digit, so "one two three four five six", "123 456", and "123-456"
 * all become "123456". Returns "" when no digits can be recovered; the
 * result must still pass isValidPinFormat before use.
 */
export function normalizePinInput(pin: string | null | undefined): string {
  if (typeof pin !== "string") return "";
  const wordsAsDigits = pin.replace(
    DIGIT_WORD_RE,
    (w) => DIGIT_WORDS[w.toLowerCase()] ?? w
  );
  return wordsAsDigits.replace(/\D/g, "");
}

/**
 * Hash a PIN for storage. Throws when the PIN format is invalid so a bad
 * value can never be persisted silently.
 */
export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN must be exactly 6 digits.");
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptKey(pin, salt, KEY_LEN);
  return [
    ENVELOPE_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a candidate PIN against a stored envelope. Returns false (never
 * throws) for malformed envelopes so a corrupt row fails closed.
 */
export async function verifyPin(pin: string, envelope: string): Promise<boolean> {
  try {
    if (!isValidPinFormat(pin) || typeof envelope !== "string") return false;
    const parts = envelope.split("$");
    if (parts.length !== 6 || parts[0] !== ENVELOPE_PREFIX) return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;
    const derived = await scryptKey(pin, salt, KEY_LEN);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** When a lockout that started at `lockedUntil` lifts, in whole seconds. */
export function lockoutSecondsRemaining(lockedUntil: Date | string | null): number {
  if (!lockedUntil) return 0;
  const ms = new Date(lockedUntil).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/* ------------------------------------------------------------------ */
/* PIN as account identifier (PIN-only voice verification)              */
/* ------------------------------------------------------------------ */

/**
 * Server pepper for the PIN identifier. Every PIN set/verify path needs it;
 * without it PINs cannot be matched to accounts, so callers must fail
 * closed when it is unset.
 */
export function getPinPepper(): string {
  const pepper = process.env.VOICE_PIN_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new Error("VOICE_PIN_PEPPER is not configured (min 16 chars).");
  }
  return pepper;
}

/**
 * Deterministic, non-reversible account identifier derived from the PIN:
 * HMAC-SHA256(pepper, pin), hex-encoded. Stored in voice_access.pin_uid
 * with a UNIQUE constraint so each 6-digit PIN identifies exactly one
 * account — the PIN itself becomes the account selector for voice
 * verification, and no email is ever needed on a call.
 *
 * Unlike the scrypt envelope (random salt per PIN), this is deterministic
 * so a caller's spoken PIN can be matched to its account with one indexed
 * lookup. The pepper keeps the identifier non-reversible: database read
 * access alone does not reveal anyone's PIN.
 */
export function pinIdentifier(pin: string, pepper?: string): string {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN must be exactly 6 digits.");
  }
  const key = pepper ?? getPinPepper();
  return createHmac("sha256", key).update(pin, "utf8").digest("hex");
}
