import { getAddress, isAddress, type Address, type Hex } from "viem";
import { KEY_P256, KEY_SECP256K1, type KeyType } from "./types";

/** One spending key prepared for a recovery step. Later steps use a different key. */
export type PreparedKey = {
  id: string;
  signer: Address;
  keyType: KeyType;
};

/** A submitted operation that has not been included. The next key stays the one already saved. */
export type PendingSend = {
  nonce: string;
  callData: Hex;
  initCode: Hex;
  nextSigner: Address;
  nextKeyType: KeyType;
  verificationGasLimit: string;
  callGasLimit: string;
  preVerificationGas: string;
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  userOpHash: string;
  kind: "send" | "cancel";
  /** Set when this phone submitted the operation. Older records omit it. */
  sentAt?: number;
  to?: string;
  asset?: string;
  amount?: string;
};

/** Per-chain account state. A rotation on one chain does not rotate another. */
export type ChainAccountState = {
  generation: string;
  hotKeyId: string | null;
  keyType: KeyType;
  deployed: boolean;
  /** This chain's own first spending key. It is not shared with another chain. */
  initialSigner?: Address | null;
  initialKey?: Hex | null;
  activationSignature?: Hex | null;
  /** Address of the spending key this phone holds after the first key. */
  currentSigner?: Address | null;
  /** A recovery key that sends must not use until this chain's hot signer matches it. */
  pendingHotKeyId?: string | null;
  pendingSigner?: Address | null;
  pendingKeyType?: KeyType | null;
  /** Recovery steps signed in one sitting, in the order they must land. */
  recoveryQueue?: PreparedKey[] | null;
  pendingSend?: PendingSend | null;
};

export type VaultRecord = {
  v: 3;
  accountIndex: number;
  account: Address | null;
  recovery: Address;
  /** Authority baked into the account address. Later recoveries do not change it. */
  originalRecovery: Address;
  /** Recovery epoch this phone has seen included. Other chains do not move with it. */
  recoveryEpoch: string;
  selectedChainId: number;
  chains: Record<string, ChainAccountState>;
};

export function emptyChainState(keyType: KeyType = KEY_SECP256K1): ChainAccountState {
  return { generation: "0", hotKeyId: null, keyType, deployed: false };
}

export function chainState(record: VaultRecord, chainId: number): ChainAccountState {
  return record.chains[String(chainId)] ?? emptyChainState();
}

export function withChainState(record: VaultRecord, chainId: number, state: ChainAccountState): VaultRecord {
  return { ...record, chains: { ...record.chains, [String(chainId)]: state } };
}

/** Older vaults stored one shared first key, or one Base generation. The shared key is dropped. */
export function migrateVaultRecord(value: unknown): VaultRecord {
  if (!value || typeof value !== "object") throw new Error("Vault record is empty.");
  const raw = value as Record<string, unknown>;
  if ((raw.v === 3 || raw.v === 2) && raw.chains && typeof raw.chains === "object") {
    return {
      v: 3,
      accountIndex: asNumber(raw.accountIndex),
      account: asAddressOrNull(raw.account),
      recovery: asAddress(raw.recovery, "recovery"),
      originalRecovery: asAddress(raw.originalRecovery ?? raw.recovery, "original recovery"),
      recoveryEpoch: typeof raw.recoveryEpoch === "string" ? raw.recoveryEpoch : "0",
      selectedChainId: asChainId(raw.selectedChainId, 84532),
      chains: raw.chains as Record<string, ChainAccountState>,
    };
  }
  return {
    v: 3,
    accountIndex: asNumber(raw.accountIndex),
    account: asAddressOrNull(raw.account),
    recovery: asAddress(raw.recovery, "recovery"),
    originalRecovery: asAddress(raw.originalRecovery ?? raw.recovery, "original recovery"),
    recoveryEpoch: "0",
    selectedChainId: 8453,
    chains: {
      "8453": {
        generation: typeof raw.localGeneration === "string" ? raw.localGeneration : "0",
        hotKeyId: typeof raw.currentKeyId === "string" ? raw.currentKeyId : null,
        keyType: raw.currentKeyType === KEY_P256 ? KEY_P256 : KEY_SECP256K1,
        deployed: false,
      },
    },
  };
}

function asChainId(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function asAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`Vault ${label} is not an address.`);
  return getAddress(value);
}

function asAddressOrNull(value: unknown): Address | null {
  if (typeof value !== "string" || !value || !isAddress(value)) return null;
  return getAddress(value);
}

