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

import { randomBytes, scrypt, timingSafeEqual } from "crypto";

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
