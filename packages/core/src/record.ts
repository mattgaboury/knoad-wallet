import { getAddress, isAddress, type Address, type Hex } from "viem";
import { CHAINS } from "./chains";
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
  /** Block time, in ms, of the send that installed this spending key. Null means this phone looked and the chain had no time. */
  keySince?: number | null;
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

/** Live chains that still need a first spending key derived from the 24 words. */
export function chainsMissingFirstKey(record: VaultRecord, chains: readonly { chainId: number }[] = CHAINS): number[] {
  return chains.filter((chain) => !chainState(record, chain.chainId).initialSigner).map((chain) => chain.chainId);
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
      selectedChainId: asChainId(raw.selectedChainId, 8453),
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

export type KnoadWallet = {
  id: string;
  kind: "knoad";
  name: string;
  accountIndex: number;
  account: Address;
  recovery: Address;
  originalRecovery: Address;
  recoveryEpoch: string;
  chains: Record<string, ChainAccountState>;
};

export type StandardWallet = {
  id: string;
  kind: "standard";
  name: string;
  address: Address;
  privateKey: Hex;
};

export type StoredWallet = KnoadWallet | StandardWallet;

export type VaultFile = {
  v: 4;
  selectedId: string;
  selectedChainId: number;
  wallets: StoredWallet[];
};

export function walletAddress(wallet: StoredWallet): Address {
  return wallet.kind === "knoad" ? wallet.account : wallet.address;
}

export function knoadRecord(wallet: KnoadWallet, selectedChainId: number): VaultRecord {
  return {
    v: 3,
    accountIndex: wallet.accountIndex,
    account: wallet.account,
    recovery: wallet.recovery,
    originalRecovery: wallet.originalRecovery,
    recoveryEpoch: wallet.recoveryEpoch,
    selectedChainId,
    chains: wallet.chains,
  };
}

export function applyRecord(file: VaultFile, record: VaultRecord): VaultFile {
  if (!record.account) return { ...file, selectedChainId: record.selectedChainId };
  return {
    ...file,
    selectedChainId: record.selectedChainId,
    wallets: file.wallets.map((wallet) => {
      if (wallet.kind !== "knoad" || wallet.id !== file.selectedId) return wallet;
      return {
        ...wallet,
        accountIndex: record.accountIndex,
        account: record.account ?? wallet.account,
        recovery: record.recovery,
        originalRecovery: record.originalRecovery,
        recoveryEpoch: record.recoveryEpoch,
        chains: record.chains,
      };
    }),
  };
}

/** A version 3 vault becomes the phone's first wallet. The 24 words stay out of the file. */
export function migrateVaultFile(value: unknown): VaultFile {
  if (value && typeof value === "object" && (value as { v?: unknown }).v === 4) return parseVaultFile(value);
  const record = migrateVaultRecord(value);
  if (!record.account) throw new Error("Vault account is not an address.");
  const wallet: KnoadWallet = {
    id: "main",
    kind: "knoad",
    name: "Main Wallet",
    accountIndex: record.accountIndex,
    account: record.account,
    recovery: record.recovery,
    originalRecovery: record.originalRecovery,
    recoveryEpoch: record.recoveryEpoch,
    chains: record.chains,
  };
  return { v: 4, selectedId: wallet.id, selectedChainId: record.selectedChainId, wallets: [wallet] };
}

function parseVaultFile(value: unknown): VaultFile {
  const raw = value as Record<string, unknown>;
  const wallets = Array.isArray(raw.wallets) ? raw.wallets.map(parseWallet) : [];
  if (wallets.length === 0) throw new Error("Vault record is empty.");
  const selectedId = typeof raw.selectedId === "string" && wallets.some((wallet) => wallet.id === raw.selectedId) ? raw.selectedId : wallets[0].id;
  return { v: 4, selectedId, selectedChainId: asChainId(raw.selectedChainId, 8453), wallets };
}

function parseWallet(value: unknown): StoredWallet {
  if (!value || typeof value !== "object") throw new Error("Vault wallet is empty.");
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id ? raw.id : "main";
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Wallet";
  if (raw.kind === "standard") {
    const privateKey = raw.privateKey;
    if (typeof privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Vault wallet is not a key.");
    return { id, kind: "standard", name, address: asAddress(raw.address, "wallet"), privateKey: privateKey as Hex };
  }
  return {
    id,
    kind: "knoad",
    name,
    accountIndex: asNumber(raw.accountIndex),
    account: asAddress(raw.account, "wallet"),
    recovery: asAddress(raw.recovery, "recovery"),
    originalRecovery: asAddress(raw.originalRecovery ?? raw.recovery, "original recovery"),
    recoveryEpoch: typeof raw.recoveryEpoch === "string" ? raw.recoveryEpoch : "0",
    chains: raw.chains && typeof raw.chains === "object" ? (raw.chains as Record<string, ChainAccountState>) : {},
  };
}

