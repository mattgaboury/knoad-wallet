import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
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

export async function readBioKey(): Promise<VaultKey> {
  const raw = await SecureStore.getItemAsync(ITEM, options);
  if (!raw) throw new Error("Biometric unlock is not set up.");
  const parsed = JSON.parse(raw) as { key: string; salt: string; t: number; m: number; p: number };
  return {
    key: hexToBytes(parsed.key),
    salt: hexToBytes(parsed.salt),
    params: { t: parsed.t, m: parsed.m, p: parsed.p },
  };
}

export function openWithHeldKey(rawVault: string, held: VaultKey): string {
  return openUtf8WithKey(JSON.parse(rawVault) as VaultBlob, held);
}
