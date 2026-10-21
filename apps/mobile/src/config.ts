import { resolveChain, type Env } from "@knoad/wallet-core";

/** Base. Ethereum, Sepolia, and Base Sepolia stay available from the switcher. */
export const DEFAULT_CHAIN_ID = 8453;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/** Off unless a development build sets this to "1". Production and preview keep it off. */
export const COMMERCE_SUBMIT_ENABLED = process.env.EXPO_PUBLIC_COMMERCE_SUBMIT === "1";

export const QUOTE_URL = (process.env.EXPO_PUBLIC_KNOAD_QUOTE_URL ?? "").replace(/\/$/, "");

/** knoad.io API. Empty hides Discord linking. */
export const KNOAD_API_URL = (process.env.EXPO_PUBLIC_KNOAD_API_URL ?? "").replace(/\/$/, "");

/** CoinGecko Demo key. Prices still load when this is empty and the public feed answers. */
export const COINGECKO_API_KEY = (process.env.EXPO_PUBLIC_COINGECKO_API_KEY ?? "").trim();

export function expoEnv(): Env {
  return {
    KNOAD_RPC_1: process.env.EXPO_PUBLIC_KNOAD_RPC_1,
    KNOAD_RPC_8453: process.env.EXPO_PUBLIC_KNOAD_RPC_8453,
    KNOAD_RPC_11155111: process.env.EXPO_PUBLIC_KNOAD_RPC_11155111,
    KNOAD_RPC_84532: process.env.EXPO_PUBLIC_KNOAD_RPC_84532,
    KNOAD_BUNDLER_1: process.env.EXPO_PUBLIC_KNOAD_BUNDLER_1,
    KNOAD_BUNDLER_8453: process.env.EXPO_PUBLIC_KNOAD_BUNDLER_8453,
    KNOAD_BUNDLER_11155111: process.env.EXPO_PUBLIC_KNOAD_BUNDLER_11155111,
    KNOAD_BUNDLER_84532: process.env.EXPO_PUBLIC_KNOAD_BUNDLER_84532,
  };
}

/** Used only when no RPC is configured. Reads stay off the bundler. */
const PUBLIC_READ_RPC: Record<number, string> = {
  1: "https://ethereum.publicnode.com",
  8453: "https://mainnet.base.org",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  84532: "https://sepolia.base.org",
};

export function chainEnv(chainId: number) {
  const resolved = resolveChain(chainId, expoEnv());
  return { ...resolved, rpcUrl: resolved.rpcUrl ?? PUBLIC_READ_RPC[chainId] ?? null };
}
