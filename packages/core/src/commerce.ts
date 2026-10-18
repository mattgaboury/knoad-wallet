import { decodeAbiParameters, encodeFunctionData, getAddress, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { encodeCalls } from "./account";
import { checkRouteCalldata } from "./routes";
import type { Call } from "./types";

export type { Call };

/**
 * Pinned from the providers' own docs on 2026-10-15 and checked on the explorers.
 * 0x AllowanceHolder (Cancun chains): https://docs.0x.org/docs/core-concepts/contracts
 * LI.FI Diamond: https://docs.li.fi/introduction/lifi-architecture/smart-contract-addresses
 * The Settler address is not pinned. 0x rotates it, and the AllowanceHolder flow
 * does not send the user operation there.
 */
export const ALLOWANCE_HOLDER = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
export const LIFI_DIAMOND = getAddress("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE");
export const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
export const NATIVE_TOKEN = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

export const DEFAULT_FEE_BPS = 25;
export const MAX_FEE_BPS = 30;
export const QUOTE_TTL_MS = 30_000;
export const DEFAULT_SLIPPAGE_BPS = 50;

const APPROVE = "0x095ea7b3";
const MAX_UINT = (1n << 256n) - 1n;

export type ListedToken = {
  chainId: number;
  symbol: string;
  address: Address;
  decimals: number;
  native: boolean;
  /** USDT-style tokens must be approved to zero before a new allowance. */
  resetApproval: boolean;
};

export const LISTED_TOKENS: readonly ListedToken[] = [
  { chainId: 1, symbol: "ETH", address: NATIVE_TOKEN, decimals: 18, native: true, resetApproval: false },
  { chainId: 1, symbol: "WETH", address: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), decimals: 18, native: false, resetApproval: false },
  { chainId: 1, symbol: "USDC", address: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), decimals: 6, native: false, resetApproval: false },
  { chainId: 8453, symbol: "ETH", address: NATIVE_TOKEN, decimals: 18, native: true, resetApproval: false },
  { chainId: 8453, symbol: "WETH", address: getAddress("0x4200000000000000000000000000000000000006"), decimals: 18, native: false, resetApproval: false },
  { chainId: 8453, symbol: "USDC", address: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), decimals: 6, native: false, resetApproval: false },
];

export type CommerceFee = {
  token: Address;
  amount: bigint;
  bps: number | null;
};

export type Approval = {
  token: Address;
  spender: Address;
  amount: bigint;
};

export type CommerceQuote = {
  provider: "0x" | "lifi";
  chainId: number;
  destinationChainId: number;
  account: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  minBuyAmount: bigint;
  slippageBps: number;
  networkFeeWei: bigint;
  providerFee: CommerceFee | null;
  knoadFee: CommerceFee;
  route: string;
  protocols: string[];
  deadline: number;
  quotedAt: number;
  calls: Call[];
  approvals: Approval[];
  /** Read from 0x calldata. The phone checks it against the 0x registry before signing. */
  settler: Address | null;
};

export type QuoteDraft = {
  provider: "0x" | "lifi";
  chainId: number;
  destinationChainId: number;
  account: Address;
  receiver: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  minBuyAmount: bigint;
  slippageBps: number;
  networkFeeWei: bigint;
  providerFee: { token: Address; amount: bigint } | null;
  knoadFeeBps: number;
  knoadFee: { token: Address; amount: bigint };
  route: string;
  protocols: string[];
  deadline: number;
  quotedAt: number;
  calls: Call[];
  requiresPermit: boolean;
};

export type SpendPolicyView = {
  periodLimit: bigint;
  windowSeconds: bigint;
  delaySeconds: bigint;
  delayThreshold: bigint;
  rejectUnlimitedApprovals: boolean;
  spent: bigint;
  /** Not in spendPolicy(). Read from storage so a finished window does not block a quote. */
  windowStart?: bigint;
};

/** KnoadAccount storage slot 7: `_spent` (uint128) then `_windowStart` (uint64). */
export const SPEND_WINDOW_SLOT = 7n;

export function windowStartFromSlot(word: bigint): bigint {
  return (word >> 128n) & ((1n << 64n) - 1n);
}

const PROVIDERS = new Set<Address>([ALLOWANCE_HOLDER, LIFI_DIAMOND]);

export function tokensForChain(chainId: number, tokens: readonly ListedToken[] = LISTED_TOKENS): ListedToken[] {
  return tokens.filter((token) => token.chainId === chainId);
}

export function findToken(chainId: number, token: Address, tokens: readonly ListedToken[] = LISTED_TOKENS): ListedToken | undefined {
  const target = normalizeToken(token);
  return tokens.find((item) => item.chainId === chainId && item.address === target);
}

export function clampFeeBps(bps: number): number {
  if (!Number.isInteger(bps) || bps < 0) throw new Error("KNOAD fee is invalid.");
  if (bps > MAX_FEE_BPS) throw new Error("KNOAD fee is above 30 bps.");
  return bps;
}

export function isProviderTarget(target: Address): boolean {
  return PROVIDERS.has(getAddress(target));
}

export function erc20Approve(token: Address, spender: Address, amount: bigint): Call {
  return {
    target: getAddress(token),
    value: 0n,
    data: encodeFunctionData({
      abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "approve",
      args: [getAddress(spender), amount],
    }),
  };
}

/** Exact allowance, with a zero reset first when the token requires it. */
export function prefixApprovals(token: ListedToken, spender: Address, amount: bigint): Call[] {
  if (token.native) return [];
  const exact = erc20Approve(token.address, spender, amount);
  if (!token.resetApproval) return [exact];
  return [erc20Approve(token.address, spender, 0n), exact];
}

export function decodeApproval(call: Call): Approval | null {
  if (!call.data.startsWith(APPROVE) || call.data.length !== 2 + 8 + 64 + 64) return null;
  const [spender, amount] = decodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    `0x${call.data.slice(10)}` as Hex,
  );
  return { token: getAddress(call.target), spender: getAddress(spender), amount };
}

export function quoteCallsHash(calls: Call[]): Hex {
  return keccak256(encodeCalls(calls));
}

export function isQuoteStale(quote: CommerceQuote, nowMs: number): boolean {
  return nowMs > quote.quotedAt + QUOTE_TTL_MS || nowMs / 1000 > quote.deadline;
}

export function nativeValue(calls: Call[]): bigint {
  return calls.reduce((sum, call) => sum + call.value, 0n);
}

export function normalizeQuote(draft: QuoteDraft, tokens: readonly ListedToken[] = LISTED_TOKENS): CommerceQuote {
  clampFeeBps(draft.knoadFeeBps);
  if (draft.requiresPermit || isPermitTarget(draft)) throw new Error("This route needs a permit signature, which rotation would invalidate.");
  if (!draft.route.trim()) throw new Error("Empty route.");
  if (draft.calls.length === 0 || draft.calls.length > 8) throw new Error("A route must contain 1 to 8 calls.");
  if (draft.sellAmount <= 0n || draft.minBuyAmount <= 0n) throw new Error("The quote has no amount.");
  if (getAddress(draft.receiver) !== getAddress(draft.account)) throw new Error("The quote receiver is not this account.");
  if (draft.knoadFeeBps === 0 && draft.knoadFee.amount !== 0n) throw new Error("A zero KNOAD fee cannot move tokens.");
  if (draft.knoadFeeBps > 0 && draft.knoadFee.amount <= 0n) throw new Error("The provider did not return the KNOAD fee.");

  const sell = requireToken(draft.chainId, draft.sellToken, tokens);
  const buy = requireToken(draft.destinationChainId, draft.buyToken, tokens);
  const account = getAddress(draft.account);
  const approvals: Approval[] = [];

  const execution = draft.calls[draft.calls.length - 1];
  draft.calls.forEach((call, index) => {
    const target = getAddress(call.target);
    if (target === zeroAddress) throw new Error("A call targets the zero address.");
    if (target === account) throw new Error("A route cannot call the account.");
    const approval = decodeApproval(call);
    if (!approval) {
      if (index !== draft.calls.length - 1) throw new Error("Only approvals may come before the provider call. That call is not to a pinned provider.");
      return;
    }
    if (approval.amount === MAX_UINT) throw new Error("Unlimited approvals are rejected.");
    if (approval.amount > draft.sellAmount) throw new Error("An approval is larger than the amount being sold.");
    if (!isProviderTarget(approval.spender)) throw new Error("An approval spender is not a pinned provider.");
    if (approval.token !== sell.address) throw new Error("An approval is for a different token than the one being sold.");
    if (call.value !== 0n) throw new Error("An approval cannot attach native value.");
    approvals.push(approval);
  });

  if (!execution || decodeApproval(execution) || !isProviderTarget(execution.target)) {
    throw new Error("The route does not end at a pinned provider.");
  }
  const provider = getAddress(execution.target);
  if (provider !== (draft.provider === "0x" ? ALLOWANCE_HOLDER : LIFI_DIAMOND)) {
    throw new Error("The route ends at a different provider than the quote names.");
  }
  if (approvals.some((approval) => approval.spender !== provider)) {
    throw new Error("An approval goes to a different provider than the route calls.");
  }
  if (execution.data.length < 10) throw new Error("Empty route.");

  if (sell.native) {
    if (approvals.length > 0) throw new Error("A native sale does not approve a token.");
    if (execution.value !== draft.sellAmount) throw new Error("The native amount does not match the quote.");
  } else if (draft.calls.some((call) => call.value !== 0n)) {
    throw new Error("A token sale cannot attach native value.");
  }

  const exact = approvals.filter((item) => item.amount !== 0n);
  const resets = approvals.filter((item) => item.amount === 0n);
  if (exact.length > 1 || resets.length > 1) throw new Error("The route has more than one approval.");
  if (sell.resetApproval && exact.length === 1 && resets.length !== 1) {
    throw new Error("This token must be approved to zero before the new allowance.");
  }
  if (exact.length === 1 && exact[0]?.amount !== draft.sellAmount) {
    throw new Error("The approval is not the exact amount being sold.");
  }
  if (!sell.native && exact.length !== 1) throw new Error("A token sale needs one exact approval.");

  const { settler } = checkRouteCalldata(execution.data, {
    provider: draft.provider,
    account,
    chainId: draft.chainId,
    destinationChainId: draft.destinationChainId,
    sellToken: sell.address,
    sellNative: sell.native,
    buyToken: buy.address,
    sellAmount: draft.sellAmount,
    minBuyAmount: draft.minBuyAmount,
  });

  return {
    settler,
    provider: draft.provider,
    chainId: draft.chainId,
    destinationChainId: draft.destinationChainId,
    account,
    sellToken: sell.address,
    buyToken: buy.address,
    sellAmount: draft.sellAmount,
    minBuyAmount: draft.minBuyAmount,
    slippageBps: draft.slippageBps,
    networkFeeWei: draft.networkFeeWei,
    providerFee: draft.providerFee ? { token: getAddress(draft.providerFee.token), amount: draft.providerFee.amount, bps: null } : null,
    knoadFee: { token: getAddress(draft.knoadFee.token), amount: draft.knoadFee.amount, bps: draft.knoadFeeBps },
    route: draft.route,
    protocols: draft.protocols,
    deadline: draft.deadline,
    quotedAt: draft.quotedAt,
    calls: draft.calls.map((call) => ({ target: getAddress(call.target), value: call.value, data: call.data })),
    approvals,
  };
}

export function rankQuotes(quotes: CommerceQuote[]): CommerceQuote[] {
  if (quotes.length === 0) return [];
  const buy = quotes[0]?.buyToken;
  if (quotes.some((quote) => quote.buyToken !== buy || quote.sellToken !== quotes[0]?.sellToken)) {
    throw new Error("Quotes for different tokens cannot be ranked together.");
  }
  return [...quotes].sort((left, right) => {
    if (withinTenthOfAPercent(left.minBuyAmount, right.minBuyAmount)) {
      if (left.networkFeeWei === right.networkFeeWei) return 0;
      return left.networkFeeWei < right.networkFeeWei ? -1 : 1;
    }
    return left.minBuyAmount > right.minBuyAmount ? -1 : 1;
  });
}

export function precheckPolicy(
  quote: CommerceQuote,
  policy: SpendPolicyView,
  nowSeconds = BigInt(Math.floor(Date.now() / 1000)),
): { ok: true } | { ok: false; reason: string } {
  const value = nativeValue(quote.calls);
  if (policy.delayThreshold > 0n && value > policy.delayThreshold) {
    return { ok: false, reason: "This amount needs the Send screen." };
  }
  const windowOver = policy.windowStart !== undefined && nowSeconds >= policy.windowStart + policy.windowSeconds;
  const spent = windowOver ? 0n : policy.spent;
  if (policy.periodLimit > 0n && value > 0n && (value > policy.periodLimit || spent + value > policy.periodLimit)) {
    return { ok: false, reason: "This is over the spending limit. Use Send, or wait." };
  }
  return { ok: true };
}

/** The shape Send already builds. It must not grow a fee or an approval. */
export function assertPlainSend(calls: Call[]): void {
  if (calls.length !== 1) throw new Error("A send is one call.");
  const call = calls[0];
  if (!call) throw new Error("A send is one call.");
  if (decodeApproval(call)) throw new Error("A send does not approve a spender.");
  if (isProviderTarget(call.target)) throw new Error("A send does not call a trading contract.");
}

export function quoteToJson(quote: CommerceQuote) {
  return {
    provider: quote.provider,
    chainId: quote.chainId,
    destinationChainId: quote.destinationChainId,
    account: quote.account,
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    sellAmount: quote.sellAmount.toString(),
    minBuyAmount: quote.minBuyAmount.toString(),
    slippageBps: quote.slippageBps,
    networkFeeWei: quote.networkFeeWei.toString(),
    providerFee: quote.providerFee ? { token: quote.providerFee.token, amount: quote.providerFee.amount.toString(), bps: quote.providerFee.bps } : null,
    knoadFee: { token: quote.knoadFee.token, amount: quote.knoadFee.amount.toString(), bps: quote.knoadFee.bps },
    route: quote.route,
    protocols: quote.protocols,
    deadline: quote.deadline,
    quotedAt: quote.quotedAt,
    calls: quote.calls.map((call) => ({ target: call.target, value: call.value.toString(), data: call.data })),
    approvals: quote.approvals.map((approval) => ({ token: approval.token, spender: approval.spender, amount: approval.amount.toString() })),
  };
}

/** Parses a proxy payload and runs the same checks as a locally built quote. */
export function quoteFromJson(value: unknown): CommerceQuote {
  const row = value as Record<string, unknown>;
  const calls = Array.isArray(row.calls) ? row.calls : [];
  const knoad = (row.knoadFee ?? {}) as { token?: string; amount?: string; bps?: number };
  const provider = row.providerFee as { token?: string; amount?: string } | null;
  return normalizeQuote({
    provider: row.provider === "lifi" ? "lifi" : "0x",
    chainId: Number(row.chainId),
    destinationChainId: Number(row.destinationChainId),
    account: String(row.account) as Address,
    receiver: String(row.account) as Address,
    sellToken: String(row.sellToken) as Address,
    buyToken: String(row.buyToken) as Address,
    sellAmount: BigInt(String(row.sellAmount)),
    minBuyAmount: BigInt(String(row.minBuyAmount)),
    slippageBps: Number(row.slippageBps),
    networkFeeWei: BigInt(String(row.networkFeeWei)),
    providerFee: provider ? { token: String(provider.token) as Address, amount: BigInt(String(provider.amount ?? "0")) } : null,
    knoadFeeBps: Number(knoad.bps),
    knoadFee: { token: String(knoad.token) as Address, amount: BigInt(String(knoad.amount)) },
    route: String(row.route ?? ""),
    protocols: Array.isArray(row.protocols) ? row.protocols.map(String) : [],
    deadline: Number(row.deadline),
    quotedAt: Number(row.quotedAt),
    calls: calls.map((call) => {
      const rowCall = call as { target?: string; value?: string; data?: string };
      return { target: String(rowCall.target) as Address, value: BigInt(rowCall.value ?? "0"), data: String(rowCall.data) as Hex };
    }),
    requiresPermit: false,
  });
}

export function formatUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function parseUnits(text: string, decimals: number): bigint {
  let trimmed = text.trim();
  if (trimmed.includes(",") && trimmed.includes(".")) throw new Error("Enter a token amount.");
  trimmed = trimmed.replace(",", ".");
  if (trimmed.startsWith(".")) trimmed = `0${trimmed}`;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Enter a token amount.");
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error("Too many decimal places.");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export type Simulation =
  | { kind: "deltas"; received: bigint }
  | { kind: "gas-only" }
  | { kind: "failed"; reason: string };

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** One ordered batch. Separate eth_calls would miss the approval. */
export async function simulateQuote(args: {
  rpc: Rpc;
  quote: CommerceQuote;
  tokens?: readonly ListedToken[];
}): Promise<Simulation> {
  const buy = findToken(args.quote.destinationChainId, args.quote.buyToken, args.tokens);
  const measureToken = buy && !buy.native && args.quote.chainId === args.quote.destinationChainId;
  const calls = args.quote.calls.map((call) => ({
    from: args.quote.account,
    to: call.target,
    data: call.data,
    value: `0x${call.value.toString(16)}`,
  }));
  if (measureToken && buy) {
    calls.push({
      from: args.quote.account,
      to: buy.address,
      data: encodeFunctionData({
        abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "balanceOf",
        args: [args.quote.account],
      }),
      value: "0x0",
    });
  }
  let simulated: unknown;
  try {
    simulated = await args.rpc("eth_simulateV1", [{ blockStateCalls: [{ calls }] }, "latest"]);
  } catch {
    return { kind: "gas-only" };
  }
  const results = readSimCalls(simulated);
  if (!results) return { kind: "gas-only" };
  if (results.some((call) => call.failed)) return { kind: "failed", reason: "This trade would fail." };
  if (!measureToken || !buy) return { kind: "gas-only" };
  const after = results[results.length - 1]?.returnData;
  if (!after) return { kind: "gas-only" };
  try {
    const before = await args.rpc("eth_call", [{ to: buy.address, data: calls[calls.length - 1]?.data }, "latest"]);
    const received = BigInt(after) - BigInt(String(before));
    return { kind: "deltas", received };
  } catch {
    return { kind: "gas-only" };
  }
}

export function simulationAllows(simulation: Simulation, minimum: bigint): { ok: true; note: string | null } | { ok: false; reason: string } {
  if (simulation.kind === "failed") return { ok: false, reason: simulation.reason };
  if (simulation.kind === "gas-only") return { ok: true, note: "Only the network fee was checked." };
  if (simulation.received < minimum) return { ok: false, reason: "You would receive less than the quote." };
  return { ok: true, note: null };
}

function requireToken(chainId: number, token: Address, tokens: readonly ListedToken[]): ListedToken {
  const found = findToken(chainId, token, tokens);
  if (!found) throw new Error("Token is not supported on this chain.");
  return found;
}

function normalizeToken(token: Address): Address {
  const address = getAddress(token);
  return address === zeroAddress ? NATIVE_TOKEN : address;
}

function isPermitTarget(draft: QuoteDraft): boolean {
  return draft.calls.some((call) => {
    const approval = decodeApproval(call);
    return approval?.spender === PERMIT2 || getAddress(call.target) === PERMIT2;
  });
}

function withinTenthOfAPercent(left: bigint, right: bigint): boolean {
  const high = left > right ? left : right;
  const low = left > right ? right : left;
  if (high === 0n) return true;
  return (high - low) * 10_000n <= high * 10n;
}

function readSimCalls(payload: unknown): { failed: boolean; returnData?: string }[] | null {
  const blocks = Array.isArray(payload) ? payload : [];
  const first = blocks[0] as { calls?: unknown[] } | undefined;
  if (!first?.calls) return null;
  return first.calls.map((call) => {
    const row = call as { status?: string | number; returnData?: string; error?: unknown };
    const status = row.status === undefined ? null : BigInt(row.status);
    return { failed: status === 0n || Boolean(row.error), returnData: row.returnData };
  });
}
