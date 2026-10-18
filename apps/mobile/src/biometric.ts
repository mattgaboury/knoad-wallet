import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { openUtf8WithKey, type VaultBlob, type VaultKey } from "@knoad/wallet-core";

const FLAG = "knoad.bio.enabled";
const ITEM = "knoad.bio.key";
const SERVICE = "knoad.biometric";

const options: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: "Unlock KNOAD",
  keychainService: SERVICE,
};

export async function readBioFlag(): Promise<boolean> {
  return (await AsyncStorage.getItem(FLAG)) === "1";
}

export async function saveBioKey(held: VaultKey): Promise<void> {
  await SecureStore.setItemAsync(
    ITEM,
    JSON.stringify({
      key: bytesToHex(held.key),
      salt: bytesToHex(held.salt),
      t: held.params.t,
      m: held.params.m,
      p: held.params.p,
    }),
    options,
  );
  await AsyncStorage.setItem(FLAG, "1");
}

export async function clearBioKey(): Promise<void> {
  await AsyncStorage.removeItem(FLAG);
  try {
    await SecureStore.deleteItemAsync(ITEM, options);
  } catch {
    // The item is already gone.
  }
}

let reading: Promise<VaultKey> | null = null;

/** One system prompt. A second call while it is open waits on the same read. */
export function readBioKey(): Promise<VaultKey> {
  if (reading) return reading;
  const pending = loadBioKey().finally(() => {
    if (reading === pending) reading = null;
  });
  reading = pending;
  return pending;
}

async function loadBioKey(): Promise<VaultKey> {
  const raw = await SecureStore.getItemAsync(ITEM, options);
  if (!raw) throw new Error("Biometric unlock is not set up.");
  const parsed = JSON.parse(raw) as { key: string; salt: string; t: number; m: number; p: number };
  return {
    key: hexToBytes(parsed.key),
    salt: hexToBytes(parsed.salt),
    params: { t: parsed.t, m: parsed.m, p: parsed.p },
  };
}

export function isBioCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /cancel/i.test(message);
}

export async function bioFailureMessage(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const method = Platform.OS === "ios" ? (face ? "Face ID" : "Touch ID") : finger ? "Fingerprint" : face ? "Face unlock" : "Fingerprint";
    return `${method} did not unlock. Try again or use the password.`;
  } catch {
    return "Fingerprint did not unlock. Try again or use the password.";
  }
}

export function openWithHeldKey(rawVault: string, held: VaultKey): string {
  return openUtf8WithKey(JSON.parse(rawVault) as VaultBlob, held);
}
