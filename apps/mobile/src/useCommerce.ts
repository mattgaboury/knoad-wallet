import { useEffect, useRef, useState } from "react";
import { getAddress, type Address, type Hex } from "viem";
import {
  accountInitCode,
  buildUserOp,
  deployments,
  executeAndRotateCalldata,
  findToken,
  formatUnits,
  isQuoteStale,
  nativeValue,
  parseUnits,
  precheckPolicy,
  quoteCallsHash,
  quoteFromJson,
  getChain,
  quoteOperationGas,
  rankQuotes,
  requireGenuineSettler,
  simulateQuote,
  simulationAllows,
  tokensForChain,
  type Call,
  type CommerceQuote,
  type KeyType,
  type ListedToken,
} from "@knoad/wallet-core";
import { chainRpc, readNativeBalance, readSpendPolicy } from "./chain";
import { chainEnv, COMMERCE_SUBMIT_ENABLED, QUOTE_URL } from "./config";

async function userOpTransaction(chainId: number, userOpHash: string): Promise<string | null> {
  const bundler = chainEnv(chainId).bundlerUrl;
  if (!bundler) return null;
  const response = await fetch(bundler, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getUserOperationReceipt", params: [userOpHash] }),
  });
  const body = (await response.json()) as { result?: { receipt?: { transactionHash?: string } } | null };
  return body.result?.receipt?.transactionHash ?? null;
}

export type QuoteView = {
  quote: CommerceQuote;
  simulationNote: string | null;
  simulatedReceived: string | null;
  gasShort: boolean;
};

type Host = {
  account: Address | null;
  chainId: number;
  generation: bigint;
  deployed: boolean;
  recovery: Address | null;
  activation: { signer: Address; signature: Hex } | null;
  keyType: KeyType;
  setNote: (note: string) => void;
  chooseChain: (chainId: number) => Promise<void>;
  submitCalls: (calls: Call[], meta?: { kind: "swap" | "bridge"; amount?: string; asset?: string; to?: string }) => Promise<string>;
};

function sameChainBuy(chainId: number, sell?: ListedToken): ListedToken | undefined {
  const tokens = tokensForChain(chainId);
  const from = sell ?? tokens[0];
  return tokens.find((token) => token.symbol === "USDC" && token.address !== from?.address) ?? tokens.find((token) => token.address !== from?.address) ?? from;
}

export function useCommerce(host: Host) {
  const skipChainReset = useRef(false);
  const requestSeq = useRef(0);
  const [amount, setAmountState] = useState("");
  const [sell, setSell] = useState<ListedToken | undefined>(tokensForChain(host.chainId)[0]);
  const [buy, setBuy] = useState<ListedToken | undefined>(sameChainBuy(host.chainId));
  const [sheet, setSheet] = useState<QuoteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [bridge, setBridge] = useState<{ userOpHash: string; txHash: string | null; from: number; to: number; status: string } | null>(null);
  const [request, setRequest] = useState<{ path: string; body: Record<string, unknown> } | null>(null);

  useEffect(() => {
    if (skipChainReset.current) {
      skipChainReset.current = false;
      return;
    }
    const tokens = tokensForChain(host.chainId);
    setSell(tokens[0]);
    setBuy(sameChainBuy(host.chainId, tokens[0]));
    setSheet(null);
  }, [host.chainId]);

  useEffect(() => {
    if (!bridge || bridge.status === "DONE" || bridge.status === "FAILED") return;
    const timer = setInterval(() => {
      void (async () => {
        if (!bridge.txHash) {
          const txHash = await userOpTransaction(bridge.from, bridge.userOpHash);
          if (txHash) setBridge((current) => (current ? { ...current, txHash, status: "PENDING" } : current));
          return;
        }
        if (!QUOTE_URL) return;
        const response = await fetch(`${QUOTE_URL}/status?txHash=${bridge.txHash}&fromChain=${bridge.from}&toChain=${bridge.to}`);
        const body = (await response.json()) as { status?: string; error?: string };
        const status = body.status ?? body.error ?? "UNKNOWN";
        setBridge((current) => (current ? { ...current, status } : current));
        if (status === "DONE") host.setNote("The bridge landed.");
        if (status === "FAILED") host.setNote("The bridge failed.");
      })().catch(() => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, [bridge?.userOpHash, bridge?.txHash, bridge?.from, bridge?.to, bridge?.status === "DONE" || bridge?.status === "FAILED"]);

  async function quote() {
    const seq = ++requestSeq.current;
    if (!host.account || !sell || !buy) {
      host.setNote("Choose a token on Ethereum or Base.");
      return;
    }
    if (!QUOTE_URL) {
      host.setNote("Set EXPO_PUBLIC_KNOAD_QUOTE_URL in apps/mobile/.env, then restart Metro.");
      return;
    }
    const bridging = buy.chainId !== host.chainId;
    setBusy(true);
    try {
      const body = {
        chainId: host.chainId,
        destinationChainId: buy.chainId,
        account: host.account,
        sellToken: sell.address,
        buyToken: buy.address,
        sellAmount: parseUnits(amount, sell.decimals).toString(),
      };
      const path = bridging ? "/quotes/bridge" : "/quotes/swap";
      const next = await fetchQuotes(path, body);
      if (seq !== requestSeq.current) return;
      const view = await review(next, host);
      if (seq !== requestSeq.current) return;
      setRequest({ path, body });
      setSheet(view);
      host.setNote("");
    } catch (error) {
      if (seq !== requestSeq.current) return;
      const offline = error instanceof TypeError || (error instanceof Error && /network request failed|failed to fetch/i.test(error.message));
      host.setNote(offline ? "Start the quote service with npm run quote." : error instanceof Error ? error.message : "Could not get a quote.");
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }

  async function confirm(): Promise<string> {
    if (!sheet || !host.account || !request || !sell || !buy) throw new Error("Get a quote first.");
    setBusy(true);
    try {
      let quoteShown = sheet.quote;
      if (isQuoteStale(quoteShown, Date.now())) {
        const fresh = await fetchQuotes(request.path, request.body);
        const view = await review(fresh, host);
        if (quoteCallsHash(view.quote.calls) !== quoteCallsHash(quoteShown.calls)) {
          setSheet(view);
          throw new Error("The quote changed. Review it again.");
        }
        quoteShown = view.quote;
        setSheet(view);
      }
      if (!COMMERCE_SUBMIT_ENABLED) {
        throw new Error(sheet.gasShort ? "Add ETH on this chain to pay the network. Nothing was sent." : "This trade is not ready to send.");
      }
      if (sheet.gasShort) throw new Error("Add ETH on this chain to pay the network.");
      const bridging = quoteShown.chainId !== quoteShown.destinationChainId;
      const hash = await host.submitCalls(quoteShown.calls, {
        kind: bridging ? "bridge" : "swap",
        amount,
        asset: sell.symbol,
        to: bridging ? getChain(buy.chainId)?.name ?? "another chain" : buy.symbol,
      });
      host.setNote("Sent. The old key stops when this lands.");
      if (bridging) {
        setBridge({ userOpHash: hash, txHash: null, from: quoteShown.chainId, to: quoteShown.destinationChainId, status: "In transit" });
      }
      setSheet(null);
      return hash;
    } finally {
      setBusy(false);
    }
  }

  function changeAmount(value: string) {
    setAmountState(value);
    setSheet(null);
  }

  function chooseSell(token: ListedToken) {
    setSell(token);
    if (buy?.chainId === token.chainId && buy.address === token.address) {
      setBuy(sameChainBuy(token.chainId, token));
    }
    setSheet(null);
  }

  function chooseBuy(token: ListedToken) {
    if (sell?.chainId === token.chainId && sell.address === token.address) {
      setSell(sameChainBuy(token.chainId, token));
    }
    setBuy(token);
    setSheet(null);
  }

  function prepare() {
    const tokens = tokensForChain(host.chainId);
    setSell(tokens[0]);
    setBuy(sameChainBuy(host.chainId, tokens[0]));
    setSheet(null);
  }

  function flip() {
    if (!sell || !buy) return;
    if (sell.chainId === buy.chainId) {
      setSell(buy);
      setBuy(sell);
      setSheet(null);
      return;
    }
    skipChainReset.current = true;
    const nextSell = buy;
    const nextBuy = sell;
    void host.chooseChain(buy.chainId).then(() => {
      setSell(nextSell);
      setBuy(nextBuy);
      setSheet(null);
    });
  }

  useEffect(() => {
    if (!host.account || !sell || !buy) return;
    if (sell.chainId === buy.chainId && sell.address === buy.address) return;
    try {
      if (parseUnits(amount, sell.decimals) <= 0n) return;
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      void quote();
    }, 500);
    return () => {
      clearTimeout(timer);
      requestSeq.current += 1;
    };
  }, [amount, sell?.address, sell?.chainId, buy?.address, buy?.chainId, host.chainId, host.account]);

  return {
    amount,
    setAmount: changeAmount,
    sell,
    setSell: chooseSell,
    buy,
    setBuy: chooseBuy,
    sheet,
    setSheet,
    busy,
    bridge,
    quote,
    confirm,
    prepare,
    flip,
  };
}

async function fetchQuotes(path: string, body: Record<string, unknown>): Promise<CommerceQuote[]> {
  const response = await fetch(`${QUOTE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { quotes?: unknown[]; error?: string };
  if (!response.ok || !payload.quotes?.length) throw new Error(payload.error ?? "No quote was available.");
  return rankQuotes(payload.quotes.map(quoteFromJson));
}

async function review(quotes: CommerceQuote[], host: Host): Promise<QuoteView> {
  if (!host.account || !host.recovery) throw new Error("Unlock this phone first.");
  const priced: CommerceQuote[] = [];
  for (const quote of quotes) priced.push(await priceQuote(quote, host));
  const quote = rankQuotes(priced)[0];
  if (!quote) throw new Error("No quote was available.");
  const rpc = (method: string, params: unknown[]) => chainRpc(quote.chainId, method, params);
  if (quote.settler) await requireGenuineSettler(rpc, quote.settler);
  const policy = precheckPolicy(quote, await readSpendPolicy(quote.chainId, host.account));
  if (!policy.ok) throw new Error(policy.reason);
  const simulation = await simulateQuote({ quote, rpc });
  const allowed = simulationAllows(simulation, quote.minBuyAmount);
  if (!allowed.ok) throw new Error(allowed.reason);
  let gasShort = false;
  try {
    const balance = await readNativeBalance(quote.chainId, host.account);
    gasShort = balance < quote.networkFeeWei + nativeValue(quote.calls);
  } catch {
    gasShort = true;
  }
  const buy = findToken(quote.destinationChainId, quote.buyToken);
  return {
    quote,
    simulationNote: allowed.note,
    simulatedReceived: simulation.kind === "deltas" && buy ? `${formatUnits(simulation.received, buy.decimals)} ${buy.symbol}` : null,
    gasShort,
  };
}

function initCodeFor(host: Host): Hex {
  if (host.deployed) return "0x";
  if (!host.account || !host.recovery || !host.activation) throw new Error("Use your 24 words to set up this chain.");
  return accountInitCode({
    factory: deployments.factory,
    recovery: host.recovery,
    initialSigner: host.activation.signer,
    signature: host.activation.signature,
  });
}

async function priceQuote(quote: CommerceQuote, host: Host): Promise<CommerceQuote> {
  if (!host.account || !host.recovery) throw new Error("Unlock this phone first.");
  const env = chainEnv(quote.chainId);
  if (!env.bundlerUrl || !env.rpcUrl) {
    throw new Error("The network fee could not be loaded.");
  }
  const callData = executeAndRotateCalldata({
    calls: quote.calls,
    nextSigner: getAddress("0x0000000000000000000000000000000000000001"),
    nextKeyType: host.keyType,
  });
  const draft = buildUserOp({
    sender: host.account,
    nonce: host.generation,
    callData,
    keyType: host.keyType,
    initCode: initCodeFor(host),
  });
  const priced = await quoteOperationGas({
    bundlerUrl: env.bundlerUrl,
    rpcUrl: env.rpcUrl,
    op: draft,
    calls: quote.calls,
    keyType: host.keyType,
    chainName: getChain(quote.chainId)?.name,
  });
  return { ...quote, networkFeeWei: priced.networkFeeWei };
}
