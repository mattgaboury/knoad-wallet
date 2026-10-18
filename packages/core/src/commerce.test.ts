import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, getAddress, toFunctionSelector, zeroAddress, type Address, type Hex } from "viem";
import {
  ALLOWANCE_HOLDER,
  DEFAULT_FEE_BPS,
  LIFI_DIAMOND,
  LISTED_TOKENS,
  MAX_FEE_BPS,
  NATIVE_TOKEN,
  PERMIT2,
  QUOTE_TTL_MS,
  assertPlainSend,
  clampFeeBps,
  erc20Approve,
  findToken,
  isQuoteStale,
  normalizeQuote,
  parseUnits,
  precheckPolicy,
  prefixApprovals,
  quoteCallsHash,
  quoteFromJson,
  quoteToJson,
  rankQuotes,
  simulateQuote,
  simulationAllows,
  windowStartFromSlot,
  type CommerceQuote,
  type ListedToken,
  type QuoteDraft,
  type SpendPolicyView,
} from "./commerce";
import { ZEROX_REGISTRY, encodeLiFiBridge, encodeLiFiSwap, encodeZeroExExec, requireGenuineSettler } from "./routes";
import type { Call } from "./types";

const ACCOUNT = getAddress("0x00000000000000000000000000000000000000aa");
const ATTACKER = getAddress("0x000000000000000000000000000000000000bad0");
const SETTLER = getAddress("0x0000000000000000000000000000000000005e77");
const USDC = findToken(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")!;
const WETH = findToken(1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")!;
const BASE_USDC = findToken(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")!;
const SELL = 1_000_000n;
const MIN = 10n ** 15n;

function zeroEx(args: { buy?: Address; min?: bigint; recipient?: Address; operator?: Address; amount?: bigint } = {}): Call {
  const data = encodeZeroExExec({
    settler: SETTLER,
    token: USDC.address,
    amount: args.amount ?? SELL,
    recipient: args.recipient ?? ACCOUNT,
    buyToken: args.buy ?? NATIVE_TOKEN,
    minAmountOut: args.min ?? MIN,
  });
  if (!args.operator) return { target: ALLOWANCE_HOLDER, value: 0n, data };
  const operatorWord = args.operator.slice(2).toLowerCase().padStart(64, "0");
  return { target: ALLOWANCE_HOLDER, value: 0n, data: `${data.slice(0, 10)}${operatorWord}${data.slice(74)}` as Hex };
}

function lifiSwap(args: { sell?: Address; buy?: Address; min?: bigint; receiver?: Address; amount?: bigint; value?: bigint } = {}): Call {
  return {
    target: LIFI_DIAMOND,
    value: args.value ?? 0n,
    data: encodeLiFiSwap({
      receiver: args.receiver ?? ACCOUNT,
      minAmountOut: args.min ?? MIN,
      sendingAssetId: args.sell ?? USDC.address,
      receivingAssetId: args.buy ?? NATIVE_TOKEN,
      fromAmount: args.amount ?? SELL,
    }),
  };
}

function lifiBridge(args: { receiver?: Address; destination?: number; destinationCall?: boolean } = {}): Call {
  return {
    target: LIFI_DIAMOND,
    value: 0n,
    data: encodeLiFiBridge({
      receiver: args.receiver ?? ACCOUNT,
      sendingAssetId: USDC.address,
      minAmount: SELL,
      destinationChainId: args.destination ?? 8453,
      hasDestinationCall: args.destinationCall,
    }),
  };
}

function draft(overrides: Partial<QuoteDraft> = {}): QuoteDraft {
  const now = 1_700_000_000_000;
  return {
    provider: "0x",
    chainId: 1,
    destinationChainId: 1,
    account: ACCOUNT,
    receiver: ACCOUNT,
    sellToken: USDC.address,
    buyToken: NATIVE_TOKEN,
    sellAmount: SELL,
    minBuyAmount: MIN,
    slippageBps: 50,
    networkFeeWei: 1000n,
    providerFee: { token: USDC.address, amount: 1000n },
    knoadFeeBps: DEFAULT_FEE_BPS,
    knoadFee: { token: USDC.address, amount: (SELL * BigInt(DEFAULT_FEE_BPS)) / 10_000n },
    route: "0x",
    protocols: ["uniswap"],
    deadline: Math.floor(now / 1000) + 30,
    quotedAt: now,
    calls: [...prefixApprovals(USDC, ALLOWANCE_HOLDER, SELL), zeroEx()],
    requiresPermit: false,
    ...overrides,
  };
}

function quoted(overrides: Partial<QuoteDraft> = {}): CommerceQuote {
  return normalizeQuote(draft(overrides));
}

const approveHolder = () => prefixApprovals(USDC, ALLOWANCE_HOLDER, SELL);
const approveDiamond = () => prefixApprovals(USDC, LIFI_DIAMOND, SELL);
const noPolicy: SpendPolicyView = { periodLimit: 0n, windowSeconds: 0n, delaySeconds: 0n, delayThreshold: 0n, rejectUnlimitedApprovals: false, spent: 0n };

test("a same-chain swap quote keeps an exact approval to AllowanceHolder", () => {
  const quote = quoted();
  assert.equal(quote.approvals.length, 1);
  assert.equal(quote.approvals[0]?.spender, ALLOWANCE_HOLDER);
  assert.equal(quote.approvals[0]?.amount, SELL);
  assert.equal(quote.knoadFee.bps, 25);
  assert.equal(quote.calls.at(-1)?.target, ALLOWANCE_HOLDER);
  assert.equal(quote.settler, SETTLER);
});

test("commerce rejects routes that would not be safe to sign", () => {
  assert.throws(() => quoted({ route: "  ", calls: [] }), /Empty route/);
  assert.throws(() => quoted({ calls: Array.from({ length: 9 }, () => zeroEx()) }), /1 to 8/);
  assert.throws(() => quoted({ calls: [{ target: zeroAddress, value: 0n, data: "0x12345678" }] }), /zero address/);
  assert.throws(() => quoted({ calls: [{ target: ACCOUNT, value: 0n, data: "0x12345678" }] }), /cannot call the account/);
  assert.throws(() => quoted({ calls: [{ target: getAddress("0x0000000000000000000000000000000000000001"), value: 0n, data: "0x12345678" }] }), /pinned provider/);
  assert.throws(() => quoted({ calls: [erc20Approve(USDC.address, ALLOWANCE_HOLDER, (1n << 256n) - 1n), zeroEx()] }), /Unlimited/);
  assert.throws(() => quoted({ calls: [...prefixApprovals(USDC, ALLOWANCE_HOLDER, SELL + 1n), zeroEx()] }), /larger than the amount/);
  assert.throws(() => quoted({ calls: [erc20Approve(USDC.address, getAddress("0x0000000000000000000000000000000000000002"), SELL), zeroEx()] }), /spender is not a pinned/);
  assert.throws(() => quoted({ receiver: getAddress("0x0000000000000000000000000000000000000003") }), /receiver/);
  assert.throws(() => quoted({ requiresPermit: true }), /permit signature/);
  assert.throws(() => quoted({ calls: [erc20Approve(USDC.address, PERMIT2, SELL), zeroEx()] }), /permit signature/);
  assert.throws(() => quoted({ sellToken: getAddress("0x0000000000000000000000000000000000000004") }), /not supported/);
  assert.throws(() => clampFeeBps(MAX_FEE_BPS + 1), /30 bps/);
  assert.throws(() => quoted({ knoadFeeBps: 0, knoadFee: { token: USDC.address, amount: 1n } }), /zero KNOAD fee/);
  assert.throws(() => quoted({ knoadFee: { token: USDC.address, amount: 0n } }), /did not return the KNOAD fee/);
});

test("a call that is not to a pinned provider cannot hide before the approval", () => {
  const drain: Call = {
    target: USDC.address,
    value: 0n,
    data: encodeFunctionData({
      abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "transfer",
      args: [ATTACKER, SELL],
    }),
  };
  assert.throws(() => quoted({ calls: [drain, ...approveHolder(), zeroEx()] }), /Only approvals may come before/);
  assert.throws(() => quoted({ calls: [...approveHolder(), zeroEx(), zeroEx()] }), /Only approvals may come before/);
});

test("the receiver, tokens, and minimum are read from the provider calldata", () => {
  assert.throws(() => quoted({ calls: [...approveHolder(), zeroEx({ recipient: ATTACKER })] }), /pays someone other/);
  assert.throws(() => quoted({ calls: [...approveHolder(), zeroEx({ min: MIN - 1n })] }), /less than the quoted minimum/);
  assert.throws(() => quoted({ calls: [...approveHolder(), zeroEx({ buy: WETH.address })] }), /buys a different token/);
  assert.throws(() => quoted({ calls: [...approveHolder(), zeroEx({ operator: ATTACKER })] }), /different contract than it calls/);
  assert.throws(() => quoted({ calls: [...approveHolder(), zeroEx({ amount: SELL - 1n })] }), /different token or amount/);
  assert.throws(() => quoted({ calls: [...approveHolder(), { target: ALLOWANCE_HOLDER, value: 0n, data: "0x12345678" }] }), /Could not read the 0x route/);
  assert.throws(() => quoted({ provider: "lifi" }), /different provider than the quote names/);
  assert.throws(() => quoted({ calls: [...approveDiamond(), zeroEx()] }), /different provider than the route calls/);
  assert.throws(() => quoted({ calls: [zeroEx()] }), /one exact approval/);

  assert.equal(quoted({ provider: "lifi", calls: [...approveDiamond(), lifiSwap()] }).settler, null);
  assert.throws(() => quoted({ provider: "lifi", calls: [...approveDiamond(), lifiSwap({ receiver: ATTACKER })] }), /pays someone other/);
  assert.throws(() => quoted({ provider: "lifi", calls: [...approveDiamond(), lifiSwap({ min: 1n })] }), /less than the quoted minimum/);
  assert.throws(() => quoted({ provider: "lifi", calls: [...approveDiamond(), lifiSwap({ sell: WETH.address })] }), /spends a different token/);
  assert.throws(() => quoted({ provider: "lifi", calls: [...approveDiamond(), lifiSwap({ amount: SELL + 1n })] }), /spends more/);
  assert.throws(() => quoted({ provider: "lifi", calls: [...approveDiamond(), lifiBridge()] }), /not a swap this app can read/);
});

test("a bridge must pay this account on the named chain with no call on arrival", () => {
  const bridge = (call: Call) =>
    quoted({ provider: "lifi", destinationChainId: 8453, buyToken: BASE_USDC.address, route: "across", calls: [...approveDiamond(), call] });
  assert.equal(bridge(lifiBridge()).destinationChainId, 8453);
  assert.throws(() => bridge(lifiBridge({ receiver: ATTACKER })), /pays someone other/);
  assert.throws(() => bridge(lifiBridge({ destination: 10 })), /different chain/);
  assert.throws(() => bridge(lifiBridge({ destinationCall: true })), /call on arrival/);
  assert.throws(() => bridge(lifiSwap({ buy: BASE_USDC.address })), /cannot bridge/);
});

test("a token that must be reset is refused until the allowance is cleared", () => {
  const reset: ListedToken = { ...USDC, resetApproval: true };
  const tokens = [reset, findToken(1, NATIVE_TOKEN)!];
  assert.throws(() => normalizeQuote(draft(), tokens), /approved to zero/);
  const quote = normalizeQuote(draft({ calls: [...prefixApprovals(reset, ALLOWANCE_HOLDER, SELL), zeroEx()] }), tokens);
  assert.equal(quote.approvals[0]?.amount, 0n);
  assert.equal(quote.approvals[1]?.amount, SELL);
});

test("ranking follows the amount the user receives, then the network fee", () => {
  const betterForUser = quoted({ minBuyAmount: 1000n, networkFeeWei: 50n, knoadFeeBps: 10, knoadFee: { token: USDC.address, amount: 1n }, calls: [...approveHolder(), zeroEx({ min: 1000n })] });
  const richerForKnoad = quoted({ provider: "lifi", minBuyAmount: 900n, networkFeeWei: 1n, knoadFeeBps: 30, knoadFee: { token: USDC.address, amount: 9n }, calls: [...approveDiamond(), lifiSwap({ min: 900n })] });
  assert.equal(rankQuotes([richerForKnoad, betterForUser])[0]?.provider, "0x");

  const highOutput = quoted({ minBuyAmount: 10_000n, networkFeeWei: 900n, calls: [...approveHolder(), zeroEx({ min: 10_000n })] });
  const tied = quoted({ provider: "lifi", minBuyAmount: 9_995n, networkFeeWei: 100n, calls: [...approveDiamond(), lifiSwap({ min: 9_995n })] });
  assert.equal(rankQuotes([highOutput, tied])[0]?.provider, "lifi");
});

test("policy precheck stops a quote that would burn a nonce", () => {
  const eth = findToken(1, NATIVE_TOKEN)!;
  const value = 2n * 10n ** 18n;
  const moving = quoted({
    provider: "lifi",
    sellToken: eth.address,
    buyToken: USDC.address,
    sellAmount: value,
    calls: [lifiSwap({ sell: zeroAddress, buy: USDC.address, amount: value, value })],
  });
  assert.equal(precheckPolicy(moving, { ...noPolicy, delaySeconds: 60n, delayThreshold: 10n ** 18n }).ok, false);
  assert.equal(precheckPolicy(moving, { ...noPolicy, periodLimit: 10n ** 18n, windowSeconds: 86_400n }).ok, false);
  assert.equal(precheckPolicy(quoted(), noPolicy).ok, true);

  const window = { ...noPolicy, periodLimit: 3n * 10n ** 18n, windowSeconds: 86_400n, spent: 2n * 10n ** 18n, windowStart: 100n };
  assert.equal(precheckPolicy(moving, window, 200n).ok, false);
  assert.equal(precheckPolicy(moving, window, 100n + 86_400n).ok, true);
  assert.equal(windowStartFromSlot((123n << 128n) | 5n), 123n);
});

test("a send never adds a trading call", () => {
  const send: { target: Address; value: bigint; data: Hex }[] = [{ target: ACCOUNT, value: 0n, data: "0x" }];
  assert.doesNotThrow(() => assertPlainSend(send));
  assert.throws(() => assertPlainSend(quoted().calls), /one call|trading contract|approve/);
});

test("quotes expire after thirty seconds", () => {
  const quote = quoted();
  assert.equal(isQuoteStale(quote, quote.quotedAt + QUOTE_TTL_MS), false);
  assert.equal(isQuoteStale(quote, quote.quotedAt + QUOTE_TTL_MS + 1), true);
  assert.equal(quoteCallsHash(quote.calls), quoteCallsHash(quote.calls));
});

test("simulation refuses a shortfall and survives a node without eth_simulateV1", async () => {
  const quote = quoted({ buyToken: WETH.address, calls: [...approveHolder(), zeroEx({ buy: WETH.address })] });
  const short = await simulateQuote({
    quote,
    rpc: async (method) => {
      if (method === "eth_simulateV1") {
        return [{ calls: [{ status: "0x1" }, { status: "0x1" }, { status: "0x1", returnData: "0x10" }] }];
      }
      return "0x20";
    },
  });
  assert.equal(short.kind, "deltas");
  if (short.kind === "deltas") assert.equal(simulationAllows(short, quote.minBuyAmount).ok, false);

  const missing = await simulateQuote({
    quote,
    rpc: async () => {
      throw new Error("method not found");
    },
  });
  assert.equal(missing.kind, "gas-only");
  assert.equal(simulationAllows(missing, quote.minBuyAmount).ok, true);
});

test("a proxy payload is checked again on the phone", () => {
  const quote = quoted();
  const restored = quoteFromJson(quoteToJson(quote));
  assert.equal(quoteCallsHash(restored.calls), quoteCallsHash(quote.calls));
  assert.equal(restored.settler, SETTLER);
  const tampered = quoteToJson(quote);
  tampered.calls[tampered.calls.length - 1]!.target = getAddress("0x0000000000000000000000000000000000000009");
  assert.throws(() => quoteFromJson(tampered), /pinned provider/);
  const redirected = quoteToJson(quote);
  redirected.calls[redirected.calls.length - 1]!.data = zeroEx({ recipient: ATTACKER }).data;
  assert.throws(() => quoteFromJson(redirected), /pays someone other/);
});

test("the 0x Settler must be the one the registry names", async () => {
  const ownerOf = toFunctionSelector("ownerOf(uint256)");
  const registry = (current: Address | "revert", previous: Address) => async (_method: string, params: unknown[]) => {
    const call = params[0] as { to: Address; data: Hex };
    assert.equal(getAddress(call.to), ZEROX_REGISTRY);
    if (call.data.startsWith(ownerOf)) {
      if (current === "revert") throw new Error("execution reverted");
      return encodeAbiParameters([{ type: "address" }], [current]);
    }
    return encodeAbiParameters([{ type: "address" }], [previous]);
  };
  await assert.doesNotReject(requireGenuineSettler(registry(SETTLER, ATTACKER), SETTLER));
  await assert.doesNotReject(requireGenuineSettler(registry(ATTACKER, SETTLER), SETTLER));
  await assert.rejects(requireGenuineSettler(registry(ATTACKER, ATTACKER), SETTLER), /does not name/);
  await assert.rejects(requireGenuineSettler(registry("revert", SETTLER), SETTLER), /paused/);
});

test("a leading dot or a comma is a token amount", () => {
  assert.equal(parseUnits(".001", 18), 1_000_000_000_000_000n);
  assert.equal(parseUnits("0,001", 18), 1_000_000_000_000_000n);
  assert.equal(parseUnits("1,5", 18), 1_500_000_000_000_000_000n);
  assert.throws(() => parseUnits("1.2,3", 18), /Enter a token amount/);
});

test("listed tokens are only ETH, WETH, and USDC on Ethereum and Base", () => {
  assert.deepEqual(LISTED_TOKENS.map((token) => `${token.chainId}:${token.symbol}`), [
    "1:ETH",
    "1:WETH",
    "1:USDC",
    "8453:ETH",
    "8453:WETH",
    "8453:USDC",
  ]);
});
