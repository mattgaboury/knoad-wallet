import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import {
  ALLOWANCE_HOLDER,
  LIFI_DIAMOND,
  NATIVE_TOKEN,
  PERMIT2,
  findToken,
  normalizeQuote,
  prefixApprovals,
  type Call,
  type CommerceQuote,
  type QuoteDraft,
} from "../../../packages/core/src/commerce";
import type { FeeConfig } from "./fees";

export type QuoteRequest = {
  chainId: number;
  destinationChainId: number;
  account: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  slippageBps: number;
};

const ZEROX = "https://api.0x.org/swap/allowance-holder/quote";
const LIFI = "https://li.quest/v1/quote";

export async function quoteZeroEx(args: {
  request: QuoteRequest;
  fee: FeeConfig;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<CommerceQuote> {
  const url = new URL(ZEROX);
  url.searchParams.set("chainId", String(args.request.chainId));
  url.searchParams.set("sellToken", args.request.sellToken);
  url.searchParams.set("buyToken", args.request.buyToken);
  url.searchParams.set("sellAmount", args.request.sellAmount.toString());
  url.searchParams.set("taker", args.request.account);
  url.searchParams.set("slippageBps", String(args.request.slippageBps));
  if (args.fee.recipient && args.fee.bps > 0) {
    url.searchParams.set("swapFeeRecipient", args.fee.recipient);
    url.searchParams.set("swapFeeBps", String(args.fee.bps));
    url.searchParams.set("swapFeeToken", args.request.sellToken);
  }
  const response = await (args.fetchImpl ?? fetch)(url, {
    headers: { "0x-api-key": args.apiKey, "0x-version": "v2" },
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(publicMessage(body, "0x did not return a quote."));
  return mapZeroEx(body, args.request, args.fee);
}

export async function quoteLiFi(args: {
  request: QuoteRequest;
  fee: FeeConfig;
  integrator: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<CommerceQuote> {
  const url = new URL(LIFI);
  url.searchParams.set("fromChain", String(args.request.chainId));
  url.searchParams.set("toChain", String(args.request.destinationChainId));
  url.searchParams.set("fromToken", lifiToken(args.request.sellToken));
  url.searchParams.set("toToken", lifiToken(args.request.buyToken));
  url.searchParams.set("fromAmount", args.request.sellAmount.toString());
  url.searchParams.set("fromAddress", args.request.account);
  url.searchParams.set("toAddress", args.request.account);
  url.searchParams.set("integrator", args.integrator);
  url.searchParams.set("slippage", String(args.request.slippageBps / 10_000));
  url.searchParams.set("order", "CHEAPEST");
  if (args.fee.bps > 0) url.searchParams.set("fee", (args.fee.bps / 10_000).toFixed(4));
  const headers: Record<string, string> = {};
  if (args.apiKey) headers["x-lifi-api-key"] = args.apiKey;
  const response = await (args.fetchImpl ?? fetch)(url, { headers });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(publicMessage(body, "LI.FI did not return a quote."));
  return mapLiFi(body, args.request, args.fee, args.integrator);
}

export function mapZeroEx(body: Record<string, unknown>, request: QuoteRequest, fee: FeeConfig): CommerceQuote {
  const transaction = body.transaction as { to?: string; data?: string; value?: string } | undefined;
  if (!transaction?.to || !transaction.data) throw new Error("0x did not return a transaction.");
  const issues = body.issues as { allowance?: { spender?: string } | null } | undefined;
  const spender = issues?.allowance?.spender ? getAddress(issues.allowance.spender) : null;
  const sell = findToken(request.chainId, request.sellToken);
  if (!sell) throw new Error("Token is not supported on this chain.");
  if (spender && spender !== PERMIT2 && spender !== ALLOWANCE_HOLDER) throw new Error("0x asked for an allowance to a contract that is not pinned.");
  const calls: Call[] = [];
  if (!sell.native) calls.push(...prefixApprovals(sell, ALLOWANCE_HOLDER, request.sellAmount));
  calls.push({ target: getAddress(transaction.to), value: asBigint(transaction.value ?? "0"), data: transaction.data as Hex });
  const fees = (body.fees ?? {}) as { integratorFee?: RawFee; zeroExFee?: RawFee };
  const now = Date.now();
  return normalizeQuote(draftFrom(request, fee, calls, {
    provider: "0x",
    route: "0x AllowanceHolder",
    protocols: protocolsOf(body.route),
    knoad: fee.bps === 0 ? { token: request.sellToken, amount: 0n } : readFee(fees.integratorFee, "The provider did not return the KNOAD fee."),
    providerFee: fees.zeroExFee ? readFee(fees.zeroExFee) : null,
    minBuyAmount: asBigint(body.minBuyAmount),
    networkFeeWei: asBigint((body.totalNetworkFee as string | undefined) ?? "0"),
    quotedAt: now,
    requiresPermit: spender === PERMIT2,
  }));
}

export function mapLiFi(body: Record<string, unknown>, request: QuoteRequest, fee: FeeConfig, integrator: string): CommerceQuote {
  const transaction = body.transactionRequest as { to?: string; data?: string; value?: string } | undefined;
  if (!transaction?.to || !transaction.data) throw new Error("This LI.FI route needs a signature, so it was skipped.");
  const estimate = (body.estimate ?? {}) as { toAmountMin?: string; approvalAddress?: string; gasCosts?: { amount?: string }[]; feeCosts?: RawFee[] };
  const steps = Array.isArray(body.includedSteps) ? (body.includedSteps as { tool?: string }[]) : [];
  const permit = steps.some((step) => /permit/i.test(step.tool ?? "")) || (estimate.approvalAddress ? getAddress(estimate.approvalAddress) === PERMIT2 : false);
  const sell = findToken(request.chainId, request.sellToken);
  if (!sell) throw new Error("Token is not supported on this chain.");
  const spender = estimate.approvalAddress ? getAddress(estimate.approvalAddress) : null;
  if (!permit && !sell.native && spender !== LIFI_DIAMOND) throw new Error("This LI.FI route approves a contract that is not pinned, so it was skipped.");
  const calls: Call[] = [];
  if (!sell.native) calls.push(...prefixApprovals(sell, LIFI_DIAMOND, request.sellAmount));
  calls.push({ target: getAddress(transaction.to), value: asBigint(transaction.value ?? "0"), data: transaction.data as Hex });
  const costs = estimate.feeCosts ?? [];
  const knoadCost = costs.find((cost) => cost.name?.toLowerCase().includes(integrator.toLowerCase()) || /integrator/i.test(cost.name ?? ""));
  const providerCost = costs.find((cost) => cost !== knoadCost);
  const gas = (estimate.gasCosts ?? []).reduce((sum, cost) => sum + asBigint(cost.amount ?? "0"), 0n);
  const now = Date.now();
  return normalizeQuote(draftFrom(request, fee, calls, {
    provider: "lifi",
    route: String(body.tool ?? "LI.FI"),
    protocols: steps.map((step) => step.tool ?? "").filter(Boolean),
    knoad: fee.bps === 0 ? { token: request.sellToken, amount: 0n } : readFee(knoadCost, "The provider did not return the KNOAD fee."),
    providerFee: providerCost ? readFee(providerCost) : null,
    minBuyAmount: asBigint(estimate.toAmountMin),
    networkFeeWei: gas,
    quotedAt: now,
    requiresPermit: permit,
  }));
}

type RawFee = { amount?: string; token?: string | { address?: string }; name?: string };

function draftFrom(
  request: QuoteRequest,
  fee: FeeConfig,
  calls: Call[],
  extra: {
    provider: "0x" | "lifi";
    route: string;
    protocols: string[];
    knoad: { token: Address; amount: bigint };
    providerFee: { token: Address; amount: bigint } | null;
    minBuyAmount: bigint;
    networkFeeWei: bigint;
    quotedAt: number;
    requiresPermit: boolean;
  },
): QuoteDraft {
  return {
    provider: extra.provider,
    chainId: request.chainId,
    destinationChainId: request.destinationChainId,
    account: request.account,
    receiver: request.account,
    sellToken: request.sellToken,
    buyToken: request.buyToken,
    sellAmount: request.sellAmount,
    minBuyAmount: extra.minBuyAmount,
    slippageBps: request.slippageBps,
    networkFeeWei: extra.networkFeeWei,
    providerFee: extra.providerFee,
    knoadFeeBps: fee.bps,
    knoadFee: extra.knoad,
    route: extra.route,
    protocols: extra.protocols,
    deadline: Math.floor(extra.quotedAt / 1000) + 30,
    quotedAt: extra.quotedAt,
    calls,
    requiresPermit: extra.requiresPermit,
  };
}

function readFee(fee: RawFee | undefined, missing?: string): { token: Address; amount: bigint } {
  let token: string | undefined;
  if (typeof fee?.token === "string") token = fee.token;
  else if (fee?.token && typeof fee.token === "object") token = fee.token.address;
  if (!fee?.amount || !token) {
    if (missing) throw new Error(missing);
    throw new Error("A provider fee was incomplete.");
  }
  const address = getAddress(token);
  return { token: address === zeroAddress ? NATIVE_TOKEN : address, amount: asBigint(fee.amount) };
}

function protocolsOf(route: unknown): string[] {
  const fills = (route as { fills?: { source?: string }[] } | undefined)?.fills ?? [];
  return [...new Set(fills.map((fill) => fill.source ?? "").filter(Boolean))];
}

function lifiToken(token: Address): string {
  return token === NATIVE_TOKEN ? zeroAddress : token;
}

function asBigint(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && (value.startsWith("0x") || /^\d+$/.test(value))) return BigInt(value);
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  throw new Error("Amount was not a number.");
}

function publicMessage(body: Record<string, unknown>, fallback: string): string {
  const message = typeof body.message === "string" ? body.message : typeof body.reason === "string" ? body.reason : fallback;
  return message.slice(0, 300);
}
