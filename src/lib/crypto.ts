const PBKDF2_ITERATIONS = 250_000;
const PBKDF2_HASH = "SHA-256";
const RSA_MODULUS_LENGTH = 2048;
const RSA_PUBLIC_EXPONENT = new Uint8Array([0x01, 0x00, 0x01]);

// ---------- Base64 helpers ----------
export function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++)
    bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
export function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function randomBytes(n: number): ArrayBuffer {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a.buffer;
}

// ---------- PBKDF2 → AES-KW wrapping key ----------
async function deriveWrappingKey(
  password: string,
  salt: ArrayBuffer,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    baseKey,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

// ---------- RSA keypair generation ----------
export async function generateRsaKeypair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: RSA_MODULUS_LENGTH,
      publicExponent: RSA_PUBLIC_EXPONENT,
      hash: "SHA-256",
    },
    true, // extractable so we can wrap the private key
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", key);
  return bufToB64(spki);
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    b64ToBuf(b64),
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt", "wrapKey"],
  );
}

// Wrap the private key in AES-KW using a key derived from the password.
export async function wrapPrivateKey(
  privateKey: CryptoKey,
  password: string,
): Promise<{ wrappedPrivateKey: string; salt: string }> {
  const salt = randomBytes(16);
  const wrappingKey = await deriveWrappingKey(password, salt);
  const wrapped = await crypto.subtle.wrapKey(
    "pkcs8",
    privateKey,
    wrappingKey,
    "AES-KW",
  );
  return { wrappedPrivateKey: bufToB64(wrapped), salt: bufToB64(salt) };
}

export async function unwrapPrivateKey(
  wrappedPrivateKeyB64: string,
  saltB64: string,
  password: string,
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(password, b64ToBuf(saltB64));
  return crypto.subtle.unwrapKey(
    "pkcs8",
    b64ToBuf(wrappedPrivateKeyB64),
    wrappingKey,
    "AES-KW",
    { name: "RSA-OAEP", hash: "SHA-256" },
    false, // non-extractable: cannot be exported again
    ["decrypt", "unwrapKey"],
  );
}

// ---------- Per-message encryption ----------
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  encryptedKey: string;
  encryptedKeyForSelf: string;
}

export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: CryptoKey,
  ownPublicKey: CryptoKey,
): Promise<EncryptedPayload> {
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  const rawAes = await crypto.subtle.exportKey("raw", aesKey);
  const encForRecipient = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    recipientPublicKey,
    rawAes,
  );
  const encForSelf = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    ownPublicKey,
    rawAes,
  );

  return {
    ciphertext: bufToB64(ct),
    iv: bufToB64(iv),
    encryptedKey: bufToB64(encForRecipient),
    encryptedKeyForSelf: bufToB64(encForSelf),
  };
}

export async function decryptMessage(
  payload: EncryptedPayload,
  privateKey: CryptoKey,
  isOwnMessage: boolean,
): Promise<string> {
  const wrappedKey = isOwnMessage
    ? payload.encryptedKeyForSelf
    : payload.encryptedKey;
  const rawAes = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    b64ToBuf(wrappedKey),
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    rawAes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBuf(payload.iv) },
    aesKey,
    b64ToBuf(payload.ciphertext),
  );
  return new TextDecoder().decode(pt);
}

// ---------- Public-key fingerprint (SHA-256, hex grouped) ----------
export async function publicKeyFingerprint(
  publicKeyB64: string,
): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", b64ToBuf(publicKeyB64));
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex
    .slice(0, 32)
    .match(/.{1,4}/g)!
    .join(" ");
}
