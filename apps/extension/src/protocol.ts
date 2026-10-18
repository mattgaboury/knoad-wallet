import { CHAINS, getChain } from "@knoad/wallet-core";

/** What the extension stores. A pairing topic is not a wallet key. */
export type RelayRecord = {
  account: string | null;
  chainId: number;
  approvedOrigins: string[];
  projectId: string;
  topic: string | null;
};

const KEY_MATERIAL = /mnemonic|privateKey|seedphrase|seedPhrase|"seed"|recoveryPhrase/i;

export function emptyRelay(): RelayRecord {
  return { account: null, chainId: 84532, approvedOrigins: [], projectId: "", topic: null };
}

export function sanitizeRelay(value: unknown): RelayRecord {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<RelayRecord>;
  const chainId = typeof raw.chainId === "number" && getChain(raw.chainId) ? raw.chainId : 84532;
  const record: RelayRecord = {
    account: typeof raw.account === "string" ? raw.account : null,
    chainId,
    approvedOrigins: Array.isArray(raw.approvedOrigins)
      ? raw.approvedOrigins.filter((item): item is string => typeof item === "string")
      : [],
    projectId: typeof raw.projectId === "string" ? raw.projectId : "",
    topic: typeof raw.topic === "string" ? raw.topic : null,
  };
  assertRelayHasNoKey(record);
  return record;
}

export function assertRelayHasNoKey(record: RelayRecord): void {
  const text = JSON.stringify(record);
  if (KEY_MATERIAL.test(text)) throw new Error("Extension storage would contain key material.");
}

export type RequestRoute = "accounts" | "chain" | "phone" | "reject";

const PHONE_METHODS = new Set([
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_sendCalls",
  "wallet_switchEthereumChain",
]);

export function routeExtensionRequest(method: string): RequestRoute {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return "accounts";
  if (method === "eth_chainId") return "chain";
  if (PHONE_METHODS.has(method)) return "phone";
  return "reject";
}

export function chainHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

export function accountFromNamespace(accounts: string[] | undefined): string | null {
  const first = accounts?.find((item) => item.startsWith("eip155:"));
  if (!first) return null;
  const address = first.split(":")[2];
  return address || null;
}

export const RELAY_CHAINS = CHAINS.map((chain) => chain.chainId);
export const RELAY_METHODS = [
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_sendCalls",
  "wallet_switchEthereumChain",
  "eth_chainId",
  "eth_accounts",
];
