import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAddress, isAddress, type Address } from "viem";
import { getChain } from "../../../packages/core/src/chains";
import {
  DEFAULT_SLIPPAGE_BPS,
  findToken,
  quoteToJson,
  rankQuotes,
  type CommerceQuote,
} from "../../../packages/core/src/commerce";
import { feeConfig } from "./fees";
import { quoteLiFi, quoteZeroEx, type QuoteRequest } from "./map";

const WINDOW_MS = 60_000;
const LIMIT = 30;
const hits = new Map<string, number[]>();

export type QuoteEnv = Record<string, string | undefined>;

export function allowRequest(ip: string, now = Date.now(), store: Map<string, number[]> = hits): boolean {
  const recent = (store.get(ip) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= LIMIT) {
    store.set(ip, recent);
    return false;
  }
  recent.push(now);
  store.set(ip, recent);
  return true;
}

export function resetLimits(): void {
  hits.clear();
}

export async function handleQuote(request: Request, env: QuoteEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRequest(ip)) return json({ error: "Too many quote requests. Wait a minute." }, 429);
  try {
    if (request.method === "POST" && url.pathname === "/quotes/swap") {
      const body = await readBody(request);
      const quotes = await collectSwap(body, env, fetchImpl);
      return json({ quotes: quotes.map(quoteToJson) });
    }
    if (request.method === "POST" && url.pathname === "/quotes/bridge") {
      const body = await readBody(request);
      const quote = await collectBridge(body, env, fetchImpl);
      return json({ quotes: [quoteToJson(quote)] });
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return json(await bridgeStatus(url, env, fetchImpl));
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quote failed.";
    return json({ error: scrub(message, env) }, 400);
  }
}

export function listen(port = Number(process.env.PORT ?? 8787), env: QuoteEnv = process.env): void {
  const server = createServer((req, res) => {
    void serve(req, res, env);
  });
  server.listen(port);
}

async function collectSwap(body: Record<string, unknown>, env: QuoteEnv, fetchImpl: typeof fetch): Promise<CommerceQuote[]> {
  const request = readRequest(body, false);
  const fee = feeConfig(env);
  const tasks: Promise<CommerceQuote>[] = [];
  if (env.ZEROX_API_KEY) tasks.push(quoteZeroEx({ request, fee, apiKey: env.ZEROX_API_KEY, fetchImpl }));
  tasks.push(quoteLiFi({ request, fee, integrator: env.LIFI_INTEGRATOR?.trim() || "knoad", apiKey: env.LIFI_API_KEY, fetchImpl }));
  const settled = await Promise.allSettled(tasks);
  const quotes = settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
  if (quotes.length === 0) {
    const reasons = settled.map((item) => (item.status === "rejected" ? item.reason?.message ?? "failed" : "")).filter(Boolean);
    throw new Error(reasons.join(" ") || "No quote was available.");
  }
  return rankQuotes(quotes);
}

async function collectBridge(body: Record<string, unknown>, env: QuoteEnv, fetchImpl: typeof fetch): Promise<CommerceQuote> {
  const request = readRequest(body, true);
  if (request.destinationChainId === request.chainId) throw new Error("Use swap for a same-chain trade.");
  return quoteLiFi({
    request,
    fee: feeConfig(env),
    integrator: env.LIFI_INTEGRATOR?.trim() || "knoad",
    apiKey: env.LIFI_API_KEY,
    fetchImpl,
  });
}

async function bridgeStatus(url: URL, env: QuoteEnv, fetchImpl: typeof fetch): Promise<unknown> {
  const txHash = url.searchParams.get("txHash");
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Enter the bridge transaction hash.");
  const fromChain = url.searchParams.get("fromChain");
  const toChain = url.searchParams.get("toChain");
  const target = new URL("https://li.quest/v1/status");
  target.searchParams.set("txHash", txHash);
  if (fromChain) target.searchParams.set("fromChain", fromChain);
  if (toChain) target.searchParams.set("toChain", toChain);
  const headers: Record<string, string> = {};
  if (env.LIFI_API_KEY) headers["x-lifi-api-key"] = env.LIFI_API_KEY;
  const response = await fetchImpl(target, { headers });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "Bridge status is unavailable.");
  const receiving = body.receiving as { txHash?: string } | undefined;
  return { status: body.status ?? "UNKNOWN", substatus: body.substatus ?? null, receivingTxHash: receiving?.txHash ?? null };
}

function readRequest(body: Record<string, unknown>, bridge: boolean): QuoteRequest {
  const chainId = Number(body.chainId);
  const destinationChainId = bridge ? Number(body.destinationChainId) : chainId;
  if (!getChain(chainId) || !getChain(destinationChainId)) throw new Error("Chain is not supported.");
  if (!isAddress(String(body.account ?? ""))) throw new Error("Account address is invalid.");
  const sellToken = tokenAddress(chainId, String(body.sellToken ?? ""));
  const buyToken = tokenAddress(destinationChainId, String(body.buyToken ?? ""));
  const sellAmount = BigInt(String(body.sellAmount ?? "0"));
  if (sellAmount <= 0n) throw new Error("Enter an amount.");
  const slippage = body.slippageBps === undefined ? DEFAULT_SLIPPAGE_BPS : Number(body.slippageBps);
  if (!Number.isInteger(slippage) || slippage < 0 || slippage > 500) throw new Error("Slippage must be between 0 and 500 bps.");
  return { chainId, destinationChainId, account: getAddress(String(body.account)), sellToken, buyToken, sellAmount, slippageBps: slippage };
}

function tokenAddress(chainId: number, value: string): Address {
  if (!isAddress(value)) throw new Error("Token address is invalid.");
  const token = findToken(chainId, getAddress(value));
  if (!token) throw new Error("Token is not supported on this chain.");
  return token.address;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 16_000) throw new Error("Request is too large.");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Request body must be an object.");
  return parsed as Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function scrub(message: string, env: QuoteEnv): string {
  let text = message;
  for (const secret of [env.ZEROX_API_KEY, env.LIFI_API_KEY]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text.slice(0, 300);
}

async function serve(req: IncomingMessage, res: ServerResponse, env: QuoteEnv): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const host = req.headers.host ?? "127.0.0.1";
  const request = new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
  const response = await handleQuote(request, env);
  const headers = Object.fromEntries(response.headers);
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
