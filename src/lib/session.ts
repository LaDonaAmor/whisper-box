import { importPublicKey } from "./crypto";

let privateKey: CryptoKey | null = null;
let publicKey: CryptoKey | null = null;
let publicKeyB64: string | null = null;

export function setSessionKeys(priv: CryptoKey, pubB64: string) {
  privateKey = priv;
  publicKeyB64 = pubB64;
  publicKey = null; // lazy import
}

export async function getOwnPublicKey(): Promise<CryptoKey> {
  if (!publicKeyB64) throw new Error("No session keys");
  if (!publicKey) publicKey = await importPublicKey(publicKeyB64);
  return publicKey;
}

export function getOwnPrivateKey(): CryptoKey {
  if (!privateKey) throw new Error("Locked: please log in again");
  return privateKey;
}

export function hasSessionKeys() {
  return !!privateKey;
}

export function clearSessionKeys() {
  privateKey = null;
  publicKey = null;
  publicKeyB64 = null;
}
