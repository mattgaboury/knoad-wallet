import { gcm } from "@noble/ciphers/aes";
import { argon2id, argon2idAsync } from "@noble/hashes/argon2";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { Hex } from "viem";

export type VaultParams = { t: number; m: number; p: number };

/** Production parameters. Tests pass a smaller set. */
export const PRODUCTION_VAULT: VaultParams = { t: 3, m: 65536, p: 1 };

export type VaultBlob = {
  v: 1;
  kdf: "argon2id";
  t: number;
  m: number;
  p: number;
  salt: Hex;
  nonce: Hex;
  ciphertext: Hex;
};

export function sealVault(
  password: string,
  plaintext: Uint8Array,
  params: VaultParams = PRODUCTION_VAULT,
): VaultBlob {
  if (!password) throw new Error("Vault password is empty.");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = deriveKey(password, salt, params);
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  return {
    v: 1,
    kdf: "argon2id",
    t: params.t,
    m: params.m,
    p: params.p,
    salt: bytesToHex(salt) as Hex,
    nonce: bytesToHex(nonce) as Hex,
    ciphertext: bytesToHex(ciphertext) as Hex,
  };
}

export function openVault(password: string, blob: VaultBlob): Uint8Array {
  if (blob.v !== 1 || blob.kdf !== "argon2id") throw new Error("Unsupported vault.");
  const key = deriveKey(password, hexToBytes(blob.salt), { t: blob.t, m: blob.m, p: blob.p });
  try {
    return gcm(key, hexToBytes(blob.nonce)).decrypt(hexToBytes(blob.ciphertext));
  } catch {
    throw new Error("Vault password did not open this file.");
  }
}

export function sealUtf8(password: string, text: string, params?: VaultParams): VaultBlob {
  return sealVault(password, utf8ToBytes(text), params);
}

export function openUtf8(password: string, blob: VaultBlob): string {
  return new TextDecoder().decode(openVault(password, blob));
}

export type VaultKey = {
  key: Uint8Array;
  salt: Uint8Array;
  params: VaultParams;
};

function deriveKey(password: string, salt: Uint8Array, params: VaultParams): Uint8Array {
  return argon2id(utf8ToBytes(password), salt, { ...params, dkLen: 32 });
}

function sealWithKey(plaintext: Uint8Array, held: VaultKey): VaultBlob {
  const nonce = randomBytes(12);
  const ciphertext = gcm(held.key, nonce).encrypt(plaintext);
  return {
    v: 1,
    kdf: "argon2id",
    t: held.params.t,
    m: held.params.m,
    p: held.params.p,
    salt: bytesToHex(held.salt) as Hex,
    nonce: bytesToHex(nonce) as Hex,
    ciphertext: bytesToHex(ciphertext) as Hex,
  };
}

/** Derives the key once. Later seals on this phone reuse it until the app closes. */
export async function createVaultKey(
  password: string,
  params: VaultParams = PRODUCTION_VAULT,
  onProgress?: (progress: number) => void,
): Promise<VaultKey> {
  if (!password) throw new Error("Vault password is empty.");
  const salt = randomBytes(16);
  const key = await argon2idAsync(utf8ToBytes(password), salt, { ...params, dkLen: 32, onProgress });
  return { key, salt, params };
}

export function sealUtf8WithKey(text: string, held: VaultKey): VaultBlob {
  return sealWithKey(utf8ToBytes(text), held);
}

/** Opens a blob with a key this phone already derived. The password is not required again. */
export function openUtf8WithKey(blob: VaultBlob, held: VaultKey): string {
  if (blob.v !== 1 || blob.kdf !== "argon2id") throw new Error("Unsupported vault.");
  const salt = hexToBytes(blob.salt);
  if (salt.length !== held.salt.length || salt.some((byte, index) => byte !== held.salt[index])) {
    throw new Error("Vault key does not match this file.");
  }
  try {
    return new TextDecoder().decode(gcm(held.key, hexToBytes(blob.nonce)).decrypt(hexToBytes(blob.ciphertext)));
  } catch {
    throw new Error("Vault password did not open this file.");
  }
}

export async function openUtf8Async(
  password: string,
  blob: VaultBlob,
  onProgress?: (progress: number) => void,
): Promise<{ text: string; held: VaultKey }> {
  if (blob.v !== 1 || blob.kdf !== "argon2id") throw new Error("Unsupported vault.");
  const params = { t: blob.t, m: blob.m, p: blob.p };
  const salt = hexToBytes(blob.salt);
  const key = await argon2idAsync(utf8ToBytes(password), salt, { ...params, dkLen: 32, onProgress });
  const held = { key, salt, params };
  try {
    const text = new TextDecoder().decode(gcm(key, hexToBytes(blob.nonce)).decrypt(hexToBytes(blob.ciphertext)));
    return { text, held };
  } catch {
    throw new Error("Vault password did not open this file.");
  }
}
