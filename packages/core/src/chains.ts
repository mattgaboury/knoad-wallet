import type { Address } from "viem";
import { ENTRY_POINT_V09, KEY_P256, KEY_SECP256K1, type KeyType } from "./types";

export type ChainInfo = {
  chainId: number;
  name: string;
  entryPoint: Address;
  /** True when this chain has the P-256 precompile (EIP-7951 or RIP-7212). */
  p256: boolean;
  explorer: string;
  rpcEnv: string;
  bundlerEnv: string;
  native: { name: string; symbol: string; decimals: number };
};

const ETH = { name: "Ether", symbol: "ETH", decimals: 18 };

/**
 * Ethereum and Base are confirmed. Their testnets follow the same precompiles:
 * Sepolia picked up EIP-7951 with the December 2025 upgrade, and Base Sepolia
 * has had RIP-7212 since the Fjord upgrade.
 */
export const CHAINS: readonly ChainInfo[] = [
  {
    chainId: 1,
    name: "Ethereum",
    entryPoint: ENTRY_POINT_V09,
    p256: true,
    explorer: "https://etherscan.io",
    rpcEnv: "KNOAD_RPC_1",
    bundlerEnv: "KNOAD_BUNDLER_1",
    native: ETH,
  },
  {
    chainId: 8453,
    name: "Base",
    entryPoint: ENTRY_POINT_V09,
    p256: true,
    explorer: "https://basescan.org",
    rpcEnv: "KNOAD_RPC_8453",
    bundlerEnv: "KNOAD_BUNDLER_8453",
    native: ETH,
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    entryPoint: ENTRY_POINT_V09,
    p256: true,
    explorer: "https://sepolia.etherscan.io",
    rpcEnv: "KNOAD_RPC_11155111",
    bundlerEnv: "KNOAD_BUNDLER_11155111",
    native: ETH,
  },
  {
    chainId: 84532,
    name: "Base Sepolia",
    entryPoint: ENTRY_POINT_V09,
    p256: true,
    explorer: "https://sepolia.basescan.org",
    rpcEnv: "KNOAD_RPC_84532",
    bundlerEnv: "KNOAD_BUNDLER_84532",
    native: ETH,
  },
];

/**
 * Registered, not advertised. A chain moves into CHAINS only after P-256,
 * EntryPoint v0.9, and the factory are confirmed on that chain.
 */
export const PREPARED_CHAINS: readonly ChainInfo[] = [
  {
    chainId: 56,
    name: "BNB Smart Chain",
    entryPoint: ENTRY_POINT_V09,
    p256: false,
    explorer: "https://bscscan.com",
    rpcEnv: "KNOAD_RPC_56",
    bundlerEnv: "KNOAD_BUNDLER_56",
    native: { name: "BNB", symbol: "BNB", decimals: 18 },
  },
  {
    chainId: 42161,
    name: "Arbitrum",
    entryPoint: ENTRY_POINT_V09,
    p256: false,
    explorer: "https://arbiscan.io",
    rpcEnv: "KNOAD_RPC_42161",
    bundlerEnv: "KNOAD_BUNDLER_42161",
    native: ETH,
  },
  {
    chainId: 4663,
    name: "Robinhood Chain",
    entryPoint: ENTRY_POINT_V09,
    p256: false,
    explorer: "https://robinhoodchain.blockscout.com",
    rpcEnv: "KNOAD_RPC_4663",
    bundlerEnv: "KNOAD_BUNDLER_4663",
    native: ETH,
  },
  {
    chainId: 143,
    name: "Monad",
    entryPoint: ENTRY_POINT_V09,
    p256: false,
    explorer: "https://monadscan.com",
    rpcEnv: "KNOAD_RPC_143",
    bundlerEnv: "KNOAD_BUNDLER_143",
    native: { name: "Monad", symbol: "MON", decimals: 18 },
  },
  {
    chainId: 33139,
    name: "ApeChain",
    entryPoint: ENTRY_POINT_V09,
    p256: false,
    explorer: "https://apescan.io",
    rpcEnv: "KNOAD_RPC_33139",
    bundlerEnv: "KNOAD_BUNDLER_33139",
    native: { name: "ApeCoin", symbol: "APE", decimals: 18 },
  },
];

export type Env = Record<string, string | undefined>;

export type ResolvedChain = ChainInfo & {
  rpcUrl: string | null;
  bundlerUrl: string | null;
};

export function getChain(chainId: number): ChainInfo | undefined {
  return CHAINS.find((chain) => chain.chainId === chainId);
}

export function requireChain(chainId: number): ChainInfo {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Chain ${chainId} is not supported.`);
  return chain;
}

/** Reads KNOAD_RPC_* / KNOAD_BUNDLER_*, or the EXPO_PUBLIC_ form of the same name. */
export function resolveChain(chainId: number, env: Env = readProcessEnv()): ResolvedChain {
  const info = requireChain(chainId);
  return {
    ...info,
    rpcUrl: readEnv(env, info.rpcEnv),
    bundlerUrl: readEnv(env, info.bundlerEnv),
  };
}

export function hotKeyTypeForChain(chainId: number): KeyType {
  return requireChain(chainId).p256 ? KEY_P256 : KEY_SECP256K1;
}

function readEnv(env: Env, key: string): string | null {
  const value = env[key] || env[`EXPO_PUBLIC_${key}`];
  return value && value.trim() ? value.trim() : null;
}

function readProcessEnv(): Env {
  if (typeof process === "undefined" || !process.env) return {};
  return process.env;
}
