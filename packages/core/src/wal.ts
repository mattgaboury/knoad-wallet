import type { Address } from "viem";
import type { AsyncKv, KeyType } from "./types";

export type PreparedRotation = {
  account: Address;
  chainId: number;
  fromGeneration: bigint;
  nextKeyId: string;
  nextSigner: Address;
  nextKeyType: KeyType;
};

/**
 * The contract cannot know whether the device saved the next key.
 * Persist it before producing the signature that names it.
 */
export class WriteAheadLog {
  constructor(private readonly kv: AsyncKv) {}

  async prepare(rotation: PreparedRotation): Promise<void> {
    if (!rotation.nextKeyId) throw new Error("Next key id is missing.");
    await this.kv.set(storageKey(rotation.account, rotation.chainId), JSON.stringify(serialize(rotation)));
  }

  async requirePrepared(account: Address, chainId: number, generation: bigint): Promise<PreparedRotation> {
    const raw = await this.kv.get(storageKey(account, chainId));
    if (!raw) {
      throw new Error("Write-ahead missing. Persist the next key before signing.");
    }
    const parsed = JSON.parse(raw) as ReturnType<typeof serialize>;
    if (parsed.chainId !== chainId || BigInt(parsed.fromGeneration) !== generation) {
      throw new Error("Write-ahead generation does not match the account.");
    }
    return {
      account: parsed.account,
      chainId: parsed.chainId,
      fromGeneration: BigInt(parsed.fromGeneration),
      nextKeyId: parsed.nextKeyId,
      nextSigner: parsed.nextSigner,
      nextKeyType: parsed.nextKeyType,
    };
  }

  async commit(account: Address, chainId: number): Promise<void> {
    await this.kv.delete(storageKey(account, chainId));
  }
}

export type Reconcile = "current" | "rewind" | "catch-up";

/** Chain generation is the source of truth after a reorg or a missed receipt. */
export function reconcileGeneration(local: bigint, chain: bigint): Reconcile {
  if (chain < local) return "rewind";
  if (chain > local) return "catch-up";
  return "current";
}

export class InflightQueue {
  private pending = false;

  begin(): void {
    if (this.pending) throw new Error("One operation is already in flight.");
    this.pending = true;
  }

  end(): void {
    this.pending = false;
  }
}

function storageKey(account: Address, chainId: number): string {
  return `wal:${chainId}:${account.toLowerCase()}`;
}

function serialize(rotation: PreparedRotation) {
  return {
    account: rotation.account,
    chainId: rotation.chainId,
    fromGeneration: rotation.fromGeneration.toString(),
    nextKeyId: rotation.nextKeyId,
    nextSigner: rotation.nextSigner,
    nextKeyType: rotation.nextKeyType,
  };
}
