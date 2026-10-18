import { createPublicClient, http, parseAbiItem, toCoinType, toHex, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import {
  CHAINS,
  SPEND_WINDOW_SLOT,
  accountAbi,
  deployments,
  findToken,
  formatUnits,
  predictDeployedAccount,
  tokensForChain,
  windowStartFromSlot,
  type KeyType,
  type SpendPolicyView,
} from "@knoad/wallet-core";
import { chainEnv, QUOTE_URL } from "./config";

function client(chainId: number) {
  const chain = chainEnv(chainId);
  if (!chain.rpcUrl) throw new Error(`Could not reach ${chain.name}.`);
  return createPublicClient({
    transport: http(chain.rpcUrl),
    chain: {
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    },
  });
}

/** Read-only. A Base send uses that name's Base address when the name has one. */
export async function resolveName(name: string, chainId: number): Promise<Address | null> {
  const text = name.trim();
  if (!text.includes(".")) return null;
  const rpc = chainEnv(1).rpcUrl;
  if (!rpc) return null;
  try {
    const normalized = normalize(text);
    const client = createPublicClient({ chain: mainnet, transport: http(rpc) });
    if (chainId !== 1) {
      const specific = await client.getEnsAddress({ name: normalized, coinType: toCoinType(chainId) });
      if (specific) return specific;
    }
    return await client.getEnsAddress({ name: normalized });
  } catch {
    return null;
  }
}

export function predictAccount(recovery: Address): Address {
  return predictDeployedAccount({ recovery, index: 0n });
}

const USER_OP_EVENT = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
);

const BLOCK_SECONDS = 2n;
const LOG_CHUNK = 500n;

export async function readUserOpLog(
  chainId: number,
  userOpHash: string,
  sentAtMs?: number,
): Promise<{ success: boolean; txHash: Hex; nonce: string } | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) return null;
  try {
    const publicClient = client(chainId);
    const latest = await publicClient.getBlockNumber();
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const sentSec = sentAtMs ? BigInt(Math.floor(sentAtMs / 1000)) : nowSec;
    const age = nowSec > sentSec ? nowSec - sentSec : 0n;
    const blocksAgo = age / BLOCK_SECONDS;
    const center = latest > blocksAgo ? latest - blocksAgo : 0n;
    const radius = (6n * 60n * 60n) / BLOCK_SECONDS;
    const from = center > radius ? center - radius : 0n;
    const to = center + radius > latest ? latest : center + radius;
    const chunks: Array<[bigint, bigint]> = [];
    for (let start = from; start <= to; start += LOG_CHUNK) {
      const end = start + LOG_CHUNK - 1n > to ? to : start + LOG_CHUNK - 1n;
      chunks.push([start, end]);
    }
    chunks.sort((left, right) => {
      const leftDistance = left[0] > center ? left[0] - center : center - left[0];
      const rightDistance = right[0] > center ? right[0] - center : center - right[0];
      if (leftDistance < rightDistance) return -1;
      if (leftDistance > rightDistance) return 1;
      return 0;
    });
    for (const [start, end] of chunks) {
      try {
        const logs = await publicClient.getLogs({
          address: deployments.entryPoint,
          event: USER_OP_EVENT,
          args: { userOpHash: userOpHash as Hex },
          fromBlock: start,
          toBlock: end,
        });
        const log = logs[0];
        if (!log?.transactionHash) continue;
        return { success: log.args.success === true, txHash: log.transactionHash, nonce: (log.args.nonce ?? 0n).toString() };
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function readGeneration(chainId: number, account: Address): Promise<bigint> {
  try {
    return await client(chainId).readContract({ address: account, abi: accountAbi, functionName: "generation" });
  } catch {
    return 0n;
  }
}

export async function readAuthorityNonce(chainId: number, account: Address): Promise<bigint> {
  try {
    return await client(chainId).readContract({ address: account, abi: accountAbi, functionName: "authorityNonce" });
  } catch {
    return 0n;
  }
}

export async function readRecoveryEpoch(chainId: number, account: Address): Promise<bigint> {
  try {
    return await client(chainId).readContract({ address: account, abi: accountAbi, functionName: "recoveryEpoch" });
  } catch {
    return 0n;
  }
}

export async function readHotSigner(chainId: number, account: Address): Promise<Address> {
  return client(chainId).readContract({ address: account, abi: accountAbi, functionName: "hotSigner" });
}

export async function readRecoveryAuthority(chainId: number, account: Address): Promise<Address> {
  return client(chainId).readContract({ address: account, abi: accountAbi, functionName: "recoveryAuthority" });
}

/** Throws when the chain cannot be read. A missing RPC and a failed call are not "undeployed". */
export async function readAccountFacts(
  chainId: number,
  account: Address,
): Promise<{
  deployed: boolean;
  hotSigner: Address | null;
  recoveryAuthority: Address | null;
  recoveryEpoch: bigint | null;
  generation: bigint;
  authorityNonce: bigint;
}> {
  const publicClient = client(chainId);
  const code = await publicClient.getBytecode({ address: account });
  const deployed = Boolean(code && code !== "0x");
  if (!deployed) {
    return { deployed: false, hotSigner: null, recoveryAuthority: null, recoveryEpoch: null, generation: 0n, authorityNonce: 0n };
  }
  const [hotSigner, recoveryAuthority, recoveryEpoch, generation, authorityNonce] = await Promise.all([
    publicClient.readContract({ address: account, abi: accountAbi, functionName: "hotSigner" }),
    publicClient.readContract({ address: account, abi: accountAbi, functionName: "recoveryAuthority" }),
    publicClient.readContract({ address: account, abi: accountAbi, functionName: "recoveryEpoch" }),
    publicClient.readContract({ address: account, abi: accountAbi, functionName: "generation" }),
    publicClient.readContract({ address: account, abi: accountAbi, functionName: "authorityNonce" }),
  ]);
  return { deployed, hotSigner, recoveryAuthority, recoveryEpoch, generation, authorityNonce };
}

export async function readDeployed(chainId: number, account: Address): Promise<boolean> {
  try {
    const code = await client(chainId).getBytecode({ address: account });
    return Boolean(code && code !== "0x");
  } catch {
    return false;
  }
}

export async function readBalances(
  chainId: number,
  account: Address,
): Promise<{ symbol: string; text: string; amount: bigint; decimals: number; native: boolean; unavailable: boolean }[]> {
  const rows = [];
  for (const token of tokensForChain(chainId)) {
    try {
      const amount = token.native
        ? await client(chainId).getBalance({ address: account })
        : await client(chainId).readContract({
            address: token.address,
            abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
            functionName: "balanceOf",
            args: [account],
          });
      rows.push({ symbol: token.symbol, text: formatUnits(amount, token.decimals), amount, decimals: token.decimals, native: token.native, unavailable: false });
    } catch {
      rows.push({ symbol: token.symbol, text: "—", amount: 0n, decimals: token.decimals, native: token.native, unavailable: true });
    }
  }
  return rows;
}

/** Same max-fee shape as the core gas quote: base fee times two, plus the tip. Display only. */
export async function readNetworkConditions(chainId: number): Promise<{ base: bigint; priority: bigint; maxFee: bigint } | null> {
  try {
    const block = (await chainRpc(chainId, "eth_getBlockByNumber", ["latest", false])) as { baseFeePerGas?: string } | null;
    let priority = 1_000_000_000n;
    try {
      const tip = await chainRpc(chainId, "eth_maxPriorityFeePerGas", []);
      if (typeof tip === "string") priority = BigInt(tip);
    } catch {
      priority = 1_000_000_000n;
    }
    const base = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n;
    return { base, priority, maxFee: base * 2n + priority };
  } catch {
    return null;
  }
}

/** Listed tokens other than the chain's native coin. A failed read is not treated as an empty chain. */
export async function readHoldsListedTokens(
  chainId: number,
  account: Address,
): Promise<{ holdsTokens: boolean; known: boolean }> {
  const tokens = tokensForChain(chainId).filter((token) => !token.native);
  if (tokens.length === 0) return { holdsTokens: false, known: true };
  let known = true;
  let holdsTokens = false;
  for (const token of tokens) {
    try {
      const amount = await client(chainId).readContract({
        address: token.address,
        abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
        functionName: "balanceOf",
        args: [account],
      });
      if (amount > 0n) holdsTokens = true;
    } catch {
      known = false;
    }
  }
  return { holdsTokens, known };
}

export async function readNativeBalance(chainId: number, account: Address): Promise<bigint> {
  return client(chainId).getBalance({ address: account });
}

/** An undeployed account has the zero policy. A deployed one that cannot be read refuses the quote. */
export async function readSpendPolicy(chainId: number, account: Address): Promise<SpendPolicyView> {
  const reader = client(chainId);
  const code = await reader.getBytecode({ address: account });
  if (!code || code === "0x") {
    return { periodLimit: 0n, windowSeconds: 0n, delaySeconds: 0n, delayThreshold: 0n, rejectUnlimitedApprovals: false, spent: 0n };
  }
  const [periodLimit, windowSeconds, delaySeconds, delayThreshold, rejectUnlimitedApprovals, spent] = await reader.readContract({
    address: account,
    abi: accountAbi,
    functionName: "spendPolicy",
  });
  const slot = await reader.getStorageAt({ address: account, slot: toHex(SPEND_WINDOW_SLOT, { size: 32 }) });
  const windowStart = windowStartFromSlot(BigInt(slot ?? "0x0"));
  return { periodLimit, windowSeconds, delaySeconds, delayThreshold, rejectUnlimitedApprovals, spent, windowStart };
}

export async function chainRpc(chainId: number, method: string, params: unknown[]): Promise<unknown> {
  const chain = chainEnv(chainId);
  if (!chain.rpcUrl) throw new Error(`Could not reach ${chain.name}.`);
  const response = await fetch(chain.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC request failed.");
  return body.result;
}

export type ChainLink = {
  chainId: number;
  name: string;
  read: "ready" | "unreachable";
  send: "ready" | "unreachable" | "notset" | "off";
};

/** Read-only check. The result never includes the endpoint. */
export async function probeChainLinks(): Promise<ChainLink[]> {
  return Promise.all(
    CHAINS.map(async (info) => {
      const chain = chainEnv(info.chainId);
      const read = chain.rpcUrl && (await rpcOk(chain.rpcUrl, "eth_chainId")) ? "ready" : "unreachable";
      let send: ChainLink["send"] = "notset";
      if (chain.bundlerUrl) {
        send = await entryPoint09(chain.bundlerUrl);
      }
      return { chainId: info.chainId, name: info.name, read, send };
    }),
  );
}

async function entryPoint09(url: string): Promise<ChainLink["send"]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const op = {
    sender: "0x1111111111111111111111111111111111111111",
    nonce: "0x0",
    callData: "0x",
    callGasLimit: "0x10000",
    verificationGasLimit: "0x10000",
    preVerificationGas: "0x5208",
    maxFeePerGas: "0x3b9aca00",
    maxPriorityFeePerGas: "0x3b9aca00",
    signature: `0x${"11".repeat(65)}`,
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_estimateUserOperationGas",
        params: [op, "0x433709009B8330FDa32311DF1C2AFA402eD8D009"],
      }),
      signal: controller.signal,
    });
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    const message = body.error?.message ?? "";
    if (/not currently enabled/i.test(message)) return "off";
    if (body.result !== undefined || message) return "ready";
    return "unreachable";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

/** Any HTTP reply means the quote service is up. The address is never returned. */
export async function probeQuote(): Promise<"ready" | "unreachable" | "notset"> {
  if (!QUOTE_URL) return "notset";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${QUOTE_URL}/status`, { signal: controller.signal });
    return response.status > 0 ? "ready" : "unreachable";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

async function rpcOk(url: string, method: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
      signal: controller.signal,
    });
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    return response.ok && body.error == null && body.result !== undefined;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function tokenLabel(chainId: number, token: Address): string {
  return findToken(chainId, token)?.symbol ?? token;
}

export type { KeyType };
