import { getAddress, isAddress, type Address, type Hex } from "viem";
import { getChain } from "./chains";
import { describeWethOffer, readWethOffer } from "./seaport";
import { parseTypedDataRequest } from "./typedData";
import type { Call } from "./types";

export type SessionDecision =
  | { kind: "accounts"; address: Address; chainId: number; origin?: string }
  | { kind: "chain"; chainId: number; origin?: string }
  | { kind: "switch-chain"; chainId: number; origin?: string }
  | { kind: "sign-message"; address: Address; chainId: number; message: string; origin?: string }
  | {
      kind: "sign-typed-data";
      address: Address;
      chainId: number;
      typedDataJson: string;
      summary: string;
      offer?: { amount: string; nft: string; ends: string };
      origin?: string;
    }
  | { kind: "sign-calls"; address: Address; chainId: number; calls: Call[]; summary: string; origin?: string }
  | { kind: "reject"; reason: string; origin?: string };

const ALLOWED_KEYS = new Set([
  "kind",
  "address",
  "chainId",
  "message",
  "calls",
  "reason",
  "summary",
  "target",
  "value",
  "data",
  "typedDataJson",
  "origin",
  "offer",
  "amount",
  "nft",
  "ends",
]);

/** What a paired origin is allowed to see. Never a seed, key, or vault. */
export function dappFacingState(account: Address, chainId: number) {
  return { address: getAddress(account), chainId };
}

/** The chain a sign-in message names on its own Chain ID line. */
export function messageChainId(message: string): number | null {
  for (const line of message.split("\n")) {
    if (!line.startsWith("Chain ID: ")) continue;
    return numberChain(line.slice("Chain ID: ".length));
  }
  return null;
}

/** The chain written in a typed-data domain. */
export function typedDataChainId(value: unknown): number | null {
  return numberChain(value);
}

/**
 * A signature uses the chain the request names. The wallet's selected chain
 * is only the fallback when the request does not name one.
 */
export function signatureChain(named: number | null, fallback: number): number | { reject: string } {
  if (named == null) return fallback;
  if (!getChain(named)) return { reject: "This signature checks a chain this phone does not open." };
  return named;
}

export function routeSessionRequest(input: {
  method: string;
  params?: unknown;
  account: Address;
  chainId: number;
  origin?: string;
}): SessionDecision {
  const method = input.method.trim();
  if (/mnemonic|seed|private.?key|export/i.test(method)) {
    return { kind: "reject", reason: "This request cannot see your words or spending keys." };
  }

  if (method === "eth_requestAccounts" || method === "eth_accounts") {
    return withOrigin({ kind: "accounts", address: getAddress(input.account), chainId: input.chainId }, input.origin);
  }

  if (method === "eth_chainId") {
    return { kind: "chain", chainId: input.chainId };
  }

  if (method === "wallet_switchEthereumChain") {
    const chainId = chainIdFromSwitch(input.params);
    if (chainId === null || !getChain(chainId)) return { kind: "reject", reason: "That chain is not supported." };
    return withOrigin({ kind: "switch-chain", chainId }, input.origin);
  }

  if (method === "eth_signTypedData" || method === "eth_signTypedData_v3") {
    return { kind: "reject", reason: "This signature type is not available." };
  }

  if (method === "eth_signTypedData_v4") {
    const parsed = typedDataJsonFromParams(input.params);
    if (!parsed) return { kind: "reject", reason: "Could not read the typed data." };
    const request = parseTypedDataRequest(parsed);
    const name = request?.domain.name ? ` (${request.domain.name})` : "";
    const chain = signatureChain(typedDataChainId(request?.domain.chainId), input.chainId);
    if (typeof chain !== "number") return { kind: "reject", reason: chain.reject };
    const offer = request ? readWethOffer(request, getAddress(input.account), chain) : null;
    const described = offer ? describeWethOffer(offer) : null;
    return withOrigin(
      {
        kind: "sign-typed-data",
        address: getAddress(input.account),
        chainId: chain,
        typedDataJson: parsed,
        summary: described?.summary ?? `Sign ${request?.primaryType ?? "typed data"}${name}`,
        ...(described ? { offer: { amount: described.amount, nft: described.nft, ends: described.ends } } : {}),
      },
      input.origin,
    );
  }

  if (method === "personal_sign") {
    const message = messageFromParams(method, input.params);
    if (!message) return { kind: "reject", reason: "Missing message." };
    const chain = signatureChain(messageChainId(message), input.chainId);
    if (typeof chain !== "number") return { kind: "reject", reason: chain.reject };
    return withOrigin(
      {
        kind: "sign-message",
        address: getAddress(input.account),
        chainId: chain,
        message,
      },
      input.origin,
    );
  }

  if (method === "eth_sign") {
    return { kind: "reject", reason: "This kind of signature is not available." };
  }

  if (method === "eth_sendTransaction") {
    const call = callFromTransaction(input.params);
    if (!call) return { kind: "reject", reason: "Could not read the transaction." };
    return withOrigin(
      {
        kind: "sign-calls",
        address: getAddress(input.account),
        chainId: input.chainId,
        calls: [call],
        summary: `Call ${call.target}`,
      },
      input.origin,
    );
  }

  if (method === "wallet_sendCalls") {
    const calls = callsFromSendCalls(input.params);
    if (!calls) return { kind: "reject", reason: "Could not read this request." };
    return withOrigin(
      {
        kind: "sign-calls",
        address: getAddress(input.account),
        chainId: input.chainId,
        calls,
        summary: `${calls.length} call${calls.length === 1 ? "" : "s"} in one operation`,
      },
      input.origin,
    );
  }

  return { kind: "reject", reason: "This request is not available." };
}

export function describeDecision(decision: SessionDecision, chainName: string): string {
  const origin = "origin" in decision && decision.origin ? decision.origin : "";
  const where = origin ? `${origin} on ${chainName}` : chainName;
  if (decision.kind === "sign-calls") return `${decision.summary} on ${chainName}`;
  if (decision.kind === "sign-message") return `Sign “${decision.message}” for ${where}`;
  if (decision.kind === "sign-typed-data") return `${decision.summary} for ${where}`;
  if (decision.kind === "accounts") return `Share the account with ${where}`;
  if (decision.kind === "switch-chain") return `Switch to ${chainName}`;
  if (decision.kind === "chain") return chainName;
  return decision.reason;
}

export function assertSessionHasNoKeyMaterial(value: unknown): void {
  walk(value, (key) => {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Session payload exposed unexpected field ${key}.`);
    }
  });
}

function withOrigin(decision: SessionDecision, origin: string | undefined): SessionDecision {
  if (!origin) return decision;
  return { ...decision, origin };
}

function chainIdFromSwitch(params: unknown): number | null {
  const body = Array.isArray(params) ? params[0] : params;
  if (!body || typeof body !== "object") return null;
  const chainId = (body as { chainId?: unknown }).chainId;
  if (typeof chainId === "number" && Number.isInteger(chainId)) return chainId;
  if (typeof chainId !== "string" || !chainId) return null;
  const value = chainId.startsWith("0x") ? Number.parseInt(chainId, 16) : Number(chainId);
  return Number.isInteger(value) ? value : null;
}

function typedDataJsonFromParams(params: unknown): string | null {
  if (!Array.isArray(params) || params.length < 2) return null;
  const raw = params[1];
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return parseTypedDataRequest(text) ? text : null;
}

function messageFromParams(method: string, params: unknown): string | null {
  if (!Array.isArray(params) || params.length === 0) return null;
  const raw = method === "personal_sign" ? params[0] : params[1] ?? params[0];
  if (typeof raw !== "string" || !raw) return null;
  if (raw.startsWith("0x")) {
    try {
      const bytes = raw.slice(2);
      if (bytes.length % 2 === 0 && bytes.length > 0) {
        return new TextDecoder().decode(hexToBytes(bytes));
      }
    } catch {
      return raw;
    }
  }
  return raw;
}

function callFromTransaction(params: unknown): Call | null {
  const tx = Array.isArray(params) ? params[0] : params;
  if (!tx || typeof tx !== "object") return null;
  const record = tx as { to?: unknown; value?: unknown; data?: unknown };
  if (typeof record.to !== "string" || !isAddress(record.to)) return null;
  return {
    target: getAddress(record.to),
    value: toBigint(record.value),
    data: typeof record.data === "string" && record.data.startsWith("0x") ? (record.data as Hex) : "0x",
  };
}

function callsFromSendCalls(params: unknown): Call[] | null {
  const body = Array.isArray(params) ? params[0] : params;
  if (!body || typeof body !== "object") return null;
  const calls = (body as { calls?: unknown }).calls;
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 8) return null;
  const parsed: Call[] = [];
  for (const item of calls) {
    const call = callFromTransaction(item);
    if (!call) return null;
    parsed.push(call);
  }
  return parsed;
}

function numberChain(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "bigint" && value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const parsed = text.startsWith("0x") ? Number.parseInt(text, 16) : Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toBigint(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && value) return BigInt(value);
  return 0n;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function walk(value: unknown, onKey: (key: string) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, onKey);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    onKey(key);
    walk(child, onKey);
  }
}
