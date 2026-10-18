import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { ALLOWANCE_HOLDER, LIFI_DIAMOND, NATIVE_TOKEN, PERMIT2 } from "../../../packages/core/src/commerce";
import { encodeLiFiSwap, encodeZeroExExec } from "../../../packages/core/src/routes";
import { feeConfig } from "./fees";
import { allowRequest, handleQuote } from "./server";

const ACCOUNT = getAddress("0x00000000000000000000000000000000000000aa");
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const KEY = "test-0x-key";

const SETTLER = getAddress("0x0000000000000000000000000000000000005e77");

function zeroExBody(spender = ALLOWANCE_HOLDER) {
  const data = encodeZeroExExec({ settler: SETTLER, token: USDC, amount: 1_000_000n, recipient: ACCOUNT, buyToken: NATIVE_TOKEN, minAmountOut: 2000n });
  return {
    transaction: { to: ALLOWANCE_HOLDER, data, value: "0" },
    minBuyAmount: "2000",
    issues: { allowance: { spender } },
    fees: { integratorFee: { amount: "2500", token: USDC }, zeroExFee: { amount: "100", token: USDC } },
    route: { fills: [{ source: "Uniswap_V3" }] },
  };
}

function lifiBody(min = "1500", approvalAddress: string = LIFI_DIAMOND) {
  const data = encodeLiFiSwap({ receiver: ACCOUNT, minAmountOut: BigInt(min), sendingAssetId: USDC, receivingAssetId: NATIVE_TOKEN, fromAmount: 1_000_000n });
  return {
    tool: "sushiswap",
    transactionRequest: { to: LIFI_DIAMOND, data, value: "0" },
    estimate: {
      toAmountMin: min,
      approvalAddress,
      gasCosts: [{ amount: "10" }],
      feeCosts: [{ name: "knoad", amount: "2500", token: { address: USDC } }],
    },
    includedSteps: [{ tool: "sushiswap" }],
  };
}

test("an unset fee recipient quotes with a zero KNOAD fee", () => {
  assert.deepEqual(feeConfig({}), { bps: 0, recipient: null });
  assert.throws(() => feeConfig({ KNOAD_FEE_RECIPIENT: ACCOUNT, KNOAD_FEE_BPS: "31" }), /30 bps/);
});

test("swap quotes are ranked and the provider key stays on the server", async () => {
  let seenKey = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    seenKey = new Headers(init?.headers).get("0x-api-key") ?? seenKey;
    const body = url.includes("api.0x.org") ? zeroExBody() : lifiBody();
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const response = await handleQuote(request("/quotes/swap", { chainId: 1, account: ACCOUNT, sellToken: USDC, buyToken: NATIVE_TOKEN, sellAmount: "1000000" }), {
    ZEROX_API_KEY: KEY,
    KNOAD_FEE_RECIPIENT: ACCOUNT,
    KNOAD_FEE_BPS: "25",
  }, fetchImpl);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes(KEY), false);
  assert.equal(seenKey, KEY);
  const body = JSON.parse(text) as { quotes: { provider: string; minBuyAmount: string }[] };
  assert.equal(body.quotes[0]?.provider, "0x");
  assert.equal(body.quotes[0]?.minBuyAmount, "2000");
});

test("a permit route is dropped and an unknown chain is refused", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.0x.org")) return new Response(JSON.stringify(zeroExBody(PERMIT2)), { status: 200 });
    return new Response(JSON.stringify({ ...lifiBody(), includedSteps: [{ tool: "permit2" }] }), { status: 200 });
  };
  const denied = await handleQuote(request("/quotes/swap", { chainId: 1, account: ACCOUNT, sellToken: USDC, buyToken: NATIVE_TOKEN, sellAmount: "1000000" }), { ZEROX_API_KEY: KEY }, fetchImpl);
  assert.equal(denied.status, 400);
  const unpinned: typeof fetch = async () => new Response(JSON.stringify(lifiBody("1500", "0x000000000000000000000000000000000000bad0")), { status: 200 });
  const skipped = await handleQuote(request("/quotes/swap", { chainId: 1, account: ACCOUNT, sellToken: USDC, buyToken: NATIVE_TOKEN, sellAmount: "1000000" }), {}, unpinned);
  assert.equal(skipped.status, 400);
  assert.match(await skipped.text(), /not pinned/);
  const unknown = await handleQuote(request("/quotes/swap", { chainId: 10, account: ACCOUNT, sellToken: USDC, buyToken: NATIVE_TOKEN, sellAmount: "1" }), {}, fetchImpl);
  assert.equal(unknown.status, 400);
});

test("the quote service rate-limits a single address", () => {
  const store = new Map<string, number[]>();
  for (let i = 0; i < 30; i += 1) assert.equal(allowRequest("1.2.3.4", 1_000, store), true);
  assert.equal(allowRequest("1.2.3.4", 1_000, store), false);
  assert.equal(allowRequest("5.6.7.8", 1_000, store), true);
});

function request(path: string, body: unknown): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
