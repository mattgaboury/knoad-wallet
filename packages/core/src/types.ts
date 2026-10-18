import type { Address, Hex } from "viem";

export type { Address, Hex };

export const ENTRY_POINT_V09 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009" as const;
export const KEY_SECP256K1 = 1 as const;
export const KEY_P256 = 2 as const;
export type KeyType = typeof KEY_SECP256K1 | typeof KEY_P256;

export const DOMAIN_NAME = "KNOAD Wallet";
export const DOMAIN_VERSION = "1";

export const BATCH_MODE =
  "0x0100000000000000000000000000000000000000000000000000000000000000" as Hex;

export type Policy = {
  periodLimit: bigint;
  windowSeconds: bigint;
  delaySeconds: bigint;
  delayThreshold: bigint;
  rejectUnlimitedApprovals: boolean;
  recoveryDelay: bigint;
};

export const ZERO_POLICY: Policy = {
  periodLimit: 0n,
  windowSeconds: 0n,
  delaySeconds: 0n,
  delayThreshold: 0n,
  rejectUnlimitedApprovals: false,
  recoveryDelay: 0n,
};

export type Call = {
  target: Address;
  value: bigint;
  data: Hex;
};

export type RecoveryRequest = {
  account: Address;
  chainId: bigint;
  newHotSigner: Address;
  newHotKeyType: KeyType;
  nextRecoveryAuthority: Address;
  recoveryEpoch: bigint;
  authorityNonce: bigint;
  deadline: bigint;
};

export type PackedUserOperation = {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
};

export type AsyncKv = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export function memoryKv(initial: Record<string, string> = {}): AsyncKv {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}
