import {
  enclaveHotKeystore,
  softwareHotKeystore,
  type AsyncKv,
  type EnclaveBridge,
  type HotKeyKind,
  type HotKeystore,
} from "@knoad/wallet-core";

type GlobalEnclave = { KnoadEnclave?: EnclaveBridge };

/**
 * A dev build that links the native module sets globalThis.KnoadEnclave.
 * That module keeps the P-256 key in the Secure Enclave or StrongBox and
 * never returns the private key. Expo Go has no such module, so the key
 * stays in the platform secure store instead.
 */
export function selectHotKeystore(kv: AsyncKv): { keystore: HotKeystore; mode: "enclave" | "secure-store" } {
  const bridge = (globalThis as GlobalEnclave).KnoadEnclave;
  const software = softwareHotKeystore(kv);
  if (!bridge) return { keystore: software, mode: "secure-store" };
  const enclave = enclaveHotKeystore(bridge);
  const keystore: HotKeystore = {
    create(kind: HotKeyKind = "p256") {
      if (kind === "secp256k1") return software.create("secp256k1");
      return enclave.create("p256");
    },
    sign(id, digest) {
      if (id.startsWith("secp:")) return software.sign(id, digest);
      return enclave.sign(id, digest);
    },
  };
  return { keystore, mode: "enclave" };
}

/** SecureStore rejects `:`. Key ids stay `p256:0x…` and `wal:chain:0x…` above this boundary. */
export function secureStoreKey(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe) throw new Error("SecureStore key is empty.");
  return safe;
}

export function secureStoreKv(store: {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}): AsyncKv {
  return {
    get: (key) => store.getItemAsync(secureStoreKey(key)),
    set: (key, value) => store.setItemAsync(secureStoreKey(key), value),
    delete: (key) => store.deleteItemAsync(secureStoreKey(key)),
  };
}
