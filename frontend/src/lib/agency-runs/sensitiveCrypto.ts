/**
 * Client-side encryption for sensitive assistant-panel values (SSN, tax IDs,
 * passwords, secret answers, MFA codes).
 *
 * AES-GCM-256 with a per-session key held in module memory only — the key is
 * never persisted, so sealed values become undecryptable on reload. Sealed
 * values are safe to keep in React state/refs; they are decrypted only
 * transiently for masked display (eye icon) or for the single POST that hands
 * them to the filing agent. They are never written to transcripts, events,
 * or logs.
 */

export interface SealedSensitiveValue {
  __sealed: true;
  v: 1;
  alg: "AES-GCM-256";
  /** base64 96-bit IV */
  iv: string;
  /** base64 ciphertext */
  data: string;
}

let sessionKey: CryptoKey | null = null;

async function getSessionKey(): Promise<CryptoKey> {
  if (!sessionKey) {
    sessionKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  return sessionKey;
}

/** Test-only: drop the session key so wrong-key paths can be exercised. */
export function __resetSensitiveKeyForTests(): void {
  sessionKey = null;
}

function newBytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function b64decode(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = newBytes(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Encrypt a sensitive plaintext value. Rejects empty input — callers store
 * "" directly for cleared fields instead of sealing nothing.
 */
export async function sealSensitiveValue(
  plaintext: string
): Promise<SealedSensitiveValue> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("sealSensitiveValue: refusing to seal empty plaintext");
  }
  const key = await getSessionKey();
  const iv = newBytes(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    __sealed: true,
    v: 1,
    alg: "AES-GCM-256",
    iv: b64encode(iv),
    data: b64encode(new Uint8Array(ciphertext)),
  };
}

/** Decrypt a sealed value. Throws on tampering, wrong key, or bad shape. */
export async function unsealSensitiveValue(
  sealed: SealedSensitiveValue
): Promise<string> {
  if (!isSealedSensitiveValue(sealed)) {
    throw new Error("unsealSensitiveValue: not a sealed value");
  }
  const key = await getSessionKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(sealed.iv) },
    key,
    b64decode(sealed.data)
  );
  return new TextDecoder().decode(plain);
}

export function isSealedSensitiveValue(
  v: unknown
): v is SealedSensitiveValue {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    s.__sealed === true &&
    s.v === 1 &&
    s.alg === "AES-GCM-256" &&
    typeof s.iv === "string" &&
    typeof s.data === "string"
  );
}

/** Fixed mask for sealed values — reveals nothing, not even length. */
export function sensitiveValueMask(): string {
  return "••••••••";
}
