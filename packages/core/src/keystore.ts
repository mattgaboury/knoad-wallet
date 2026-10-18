import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { signSecp256k1 } from "./account";
import { createP256Key, p256FromPrivateKey, p256SignerAddress, signP256 } from "./p256";
import { KEY_P256, KEY_SECP256K1, type AsyncKv, type KeyType } from "./types";
import type { PreparedRotation } from "./wal";

export type HotKeyKind = "p256" | "secp256k1";

export type CreatedHotKey = {
  id: string;
  signer: Address;
  keyType: KeyType;
  qx?: Hex;
  qy?: Hex;
};

export interface HotKeystore {
  create(kind?: HotKeyKind): Promise<CreatedHotKey>;
  sign(id: string, digest: Hex): Promise<Hex>;
}

/** In-memory or secure-store backed. Used when the enclave bridge is absent. */
export function softwareHotKeystore(kv: AsyncKv): HotKeystore {
  return {
    async create(kind: HotKeyKind = "p256") {
      if (kind === "secp256k1") {
        const privateKey = generatePrivateKey();
        const signer = privateKeyToAccount(privateKey).address;
        const id = `secp:${signer.toLowerCase()}`;
        await kv.set(id, privateKey);
        return { id, signer, keyType: KEY_SECP256K1 };
      }
      const key = createP256Key();
      const id = `p256:${key.signer.toLowerCase()}`;
      await kv.set(id, key.privateKey);
      return { id, signer: key.signer, keyType: KEY_P256, qx: key.qx, qy: key.qy };
    },
    async sign(id, digest) {
      const privateKey = await kv.get(id);
      if (!privateKey) throw new Error("Hot key is not in this keystore.");
      if (id.startsWith("secp:")) return signSecp256k1(privateKey as Hex, digest);
      return signP256(privateKey as Hex, digest);
    },
  };
}

export type EnclaveBridge = {
  create(): Promise<{ id: string; qx: Hex; qy: Hex }>;
  sign(id: string, digest: Hex): Promise<Hex>;
};

/** Non-exportable Secure Enclave / StrongBox. The bridge never returns a private key. */
export function enclaveHotKeystore(bridge: EnclaveBridge): HotKeystore {
  return {
    async create(kind: HotKeyKind = "p256") {
      if (kind !== "p256") throw new Error("The enclave only creates P-256 keys.");
      const created = await bridge.create();
      return {
        id: created.id,
        signer: p256SignerAddress(created.qx, created.qy),
        keyType: KEY_P256,
        qx: created.qx,
        qy: created.qy,
      };
    },
    sign(id, digest) {
      return bridge.sign(id, digest);
    },
  };
}

export async function prepareRotation(args: {
  account: Address;
  chainId: number;
  generation: bigint;
  keystore: HotKeystore;
  keyType?: KeyType;
  wal: { prepare(rotation: PreparedRotation): Promise<void> };
}): Promise<CreatedHotKey> {
  const created = await args.keystore.create(args.keyType === KEY_SECP256K1 ? "secp256k1" : "p256");
  await args.wal.prepare({
    account: args.account,
    chainId: args.chainId,
    fromGeneration: args.generation,
    nextKeyId: created.id,
    nextSigner: created.signer,
    nextKeyType: created.keyType,
  });
  return created;
}

export function publicKeyFromStored(privateKey: Hex) {
  return p256FromPrivateKey(privateKey);
}
