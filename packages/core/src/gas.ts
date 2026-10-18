import { getAddress, toHex, type Address, type Hex } from "viem";
import { buildUserOp, serializeUserOperation } from "./account";
import { deployments } from "./deployments";
import { ENTRY_POINT_V09, KEY_P256, type Call, type KeyType, type PackedUserOperation } from "./types";
import estimatorJson from "../../../test-vectors/estimator.json";

/** Simulation-only code from src/simulation/KnoadEstimator.sol. Never deployed. */
export const ESTIMATOR = {
  shadow: getAddress(estimatorJson.shadow),
  runtimeCode: estimatorJson.runtimeCode as Hex,
};

/** The estimator skips the signature check. This covers ECDSA or the P-256 precompile. */
export const SIGNATURE_VERIFICATION_GAS = 30_000n;

/**
 * Gas `executeAndRotate` uses around the payment, including the proxy.
 * Forge measured 36,383 for one ETH transfer to a contract with `receive()`.
 * The margin covers a cold recipient and the work after the call returns.
 */
export const EXECUTE_OVERHEAD = 50_000n;

/** Used when a payment cannot be estimated on its own. Never below a full call. */
const CALL_ESTIMATE_FALLBACK = 500_000n;

export type StateOverride = Record<string, { code: Hex }>;

/**
 * A dummy signature fails KnoadAccount validation, so the account never marks
 * the operation validated and its calls revert in simulation. The bundler gets
 * the estimator at the implementation address and the real code at the shadow.
 */
export async function estimatorOverride(args: {
  rpcUrl: string;
  rpc?: RpcCaller;
  implementation?: Address;
}): Promise<StateOverride> {
  const implementation = args.implementation ?? deployments.implementation;
  const code = (await (args.rpc ?? jsonRpc)(args.rpcUrl, "eth_getCode", [implementation, "latest"])) as Hex | null;
  if (!code || code === "0x") throw new Error("The KNOAD account implementation is not deployed on this chain.");
  return {
    [implementation]: { code: ESTIMATOR.runtimeCode },
    [ESTIMATOR.shadow]: { code },
  };
}

export type OperationGas = {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
};

/** Used when no bundler is configured, and by the hash fixtures. Not a quote. */
export function defaultTestGas(keyType?: KeyType): OperationGas {
  return {
    verificationGasLimit: keyType === KEY_P256 ? 8_000_000n : 1_000_000n,
    callGasLimit: 1_000_000n,
    preVerificationGas: 100_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
  };
}

/**
 * Answers both the chain and the bundler. Tests return
 * `pimlico_getUserOperationGasPrice` and `rundler_maxPriorityFeePerGas`
 * here so a quote never touches the network.
 */
export type RpcCaller = (url: string, method: string, params: unknown[]) => Promise<unknown>;

type BundlerFee = { maxPriorityFeePerGas: bigint; maxFeePerGas?: bigint };

/** The bundler's fast price, then Rundler, then nothing. The chain tip is separate. */
async function readBundlerFee(call: RpcCaller, bundlerUrl: string): Promise<BundlerFee | null> {
  try {
    const price = (await call(bundlerUrl, "pimlico_getUserOperationGasPrice", [])) as {
      fast?: { maxPriorityFeePerGas?: unknown; maxFeePerGas?: unknown };
    };
    const fast = price?.fast;
    if (!fast?.maxPriorityFeePerGas) throw new Error("Pimlico did not return a fast price.");
    return {
      maxPriorityFeePerGas: asBigint(fast.maxPriorityFeePerGas),
      maxFeePerGas: fast.maxFeePerGas === undefined ? undefined : asBigint(fast.maxFeePerGas),
    };
  } catch {
    // A bundler without this method still has a price, or the chain does.
  }
  try {
    return { maxPriorityFeePerGas: asBigint(await call(bundlerUrl, "rundler_maxPriorityFeePerGas", [])) };
  } catch {
    return null;
  }
}

/** Higher of the bundler floor and the chain tip. Max fee is 2× base + tip, or the bundler's max when that is higher. */
export async function feeQuote(args: {
  bundlerUrl: string;
  rpcUrl: string;
  rpc?: RpcCaller;
}): Promise<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }> {
  const call = args.rpc ?? ((url, method, params) => jsonRpc(url, method, params));
  const block = (await call(args.rpcUrl, "eth_getBlockByNumber", ["latest", false])) as { baseFeePerGas?: string };
  let priority = defaultTestGas().maxPriorityFeePerGas;
  try {
    priority = asBigint(await call(args.rpcUrl, "eth_maxPriorityFeePerGas", []));
  } catch {
    priority = defaultTestGas().maxPriorityFeePerGas;
  }
  const bundler = await readBundlerFee(call, args.bundlerUrl);
  if (bundler && bundler.maxPriorityFeePerGas > priority) priority = bundler.maxPriorityFeePerGas;
  const base = block?.baseFeePerGas ? asBigint(block.baseFeePerGas) : 0n;
  let maxFee = base * 2n + priority;
  if (bundler?.maxFeePerGas !== undefined && bundler.maxFeePerGas > maxFee) maxFee = bundler.maxFeePerGas;
  if (maxFee < priority) maxFee = priority;
  return { maxPriorityFeePerGas: priority, maxFeePerGas: maxFee };
}

/** Overhead plus each payment's own gas. The bundler number does not include the payment. */
export async function paymentCallGas(args: {
  rpcUrl: string;
  from: Address;
  calls: readonly Call[];
  rpc?: RpcCaller;
}): Promise<bigint> {
  const call = args.rpc ?? ((url, method, params) => jsonRpc(url, method, params));
  let inner = 0n;
  for (const item of args.calls) {
    try {
      const estimated = await call(args.rpcUrl, "eth_estimateGas", [
        {
          from: args.from,
          to: item.target,
          value: toHex(item.value),
          data: item.data,
        },
      ]);
      inner += asBigint(estimated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/insufficient funds/i.test(message)) {
        throw new Error("This amount plus the network fee is more than the ETH in this account.");
      }
      inner += CALL_ESTIMATE_FALLBACK;
    }
  }
  return EXECUTE_OVERHEAD + inner;
}

export function bufferedGas(value: bigint, bufferBps = 2_000n): bigint {
  return (value * (10_000n + bufferBps)) / 10_000n;
}

/** A payment below the measured account overhead never reaches the recipient. */
export function assertCallGas(gas: OperationGas, calls: readonly Call[]): void {
  if (calls.length === 0) return;
  if (gas.callGasLimit < bufferedGas(EXECUTE_OVERHEAD)) {
    throw new Error("The network fee could not be sized. Nothing was sent.");
  }
}

export async function estimateOperation(args: {
  bundlerUrl: string;
  rpcUrl: string;
  op: Omit<PackedUserOperation, "signature">;
  calls?: readonly Call[];
  keyType?: KeyType;
  entryPoint?: Address;
  bufferBps?: bigint;
  chainName?: string;
  rpc?: RpcCaller;
}): Promise<{ gas: OperationGas; networkFeeWei: bigint }> {
  const call = args.rpc ?? ((url, method, params) => jsonRpc(url, method, params, args.chainName));
  const signature = dummySignature(args.keyType);
  const override = await estimatorOverride({ rpcUrl: args.rpcUrl, rpc: call });
  const estimated = (await call(args.bundlerUrl, "eth_estimateUserOperationGas", [
    serializeUserOperation({ ...args.op, signature }),
    args.entryPoint ?? ENTRY_POINT_V09,
    override,
  ])) as { preVerificationGas?: string; verificationGasLimit?: string; callGasLimit?: string };
  const buffer = args.bufferBps ?? 2_000n;
  const scale = (value: bigint) => bufferedGas(value, buffer);
  let callLimit = asBigint(estimated.callGasLimit);
  if (args.calls) {
    const floor = await paymentCallGas({ rpcUrl: args.rpcUrl, from: args.op.sender, calls: args.calls, rpc: call });
    if (floor > callLimit) callLimit = floor;
  }
  const fees = await feeQuote({ bundlerUrl: args.bundlerUrl, rpcUrl: args.rpcUrl, rpc: call });
  const gas: OperationGas = {
    verificationGasLimit: scale(asBigint(estimated.verificationGasLimit) + SIGNATURE_VERIFICATION_GAS),
    callGasLimit: scale(callLimit),
    preVerificationGas: scale(asBigint(estimated.preVerificationGas)),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    maxFeePerGas: fees.maxFeePerGas,
  };
  const networkFeeWei = (gas.preVerificationGas + gas.verificationGasLimit + gas.callGasLimit) * gas.maxFeePerGas;
  return { gas, networkFeeWei };
}

export function networkFeeOf(gas: OperationGas): bigint {
  return (gas.preVerificationGas + gas.verificationGasLimit + gas.callGasLimit) * gas.maxFeePerGas;
}

export function dummySignature(keyType?: KeyType): Hex {
  const size = keyType === KEY_P256 ? 128 : 65;
  return toHex(new Uint8Array(size).fill(1));
}

/** Rebuilds an operation with estimated gas. The fixed defaults stay for tests. */
export async function quoteOperationGas(args: {
  bundlerUrl: string;
  rpcUrl: string;
  op: Omit<PackedUserOperation, "signature">;
  calls?: readonly Call[];
  keyType?: KeyType;
  chainName?: string;
  rpc?: RpcCaller;
}): Promise<{ op: Omit<PackedUserOperation, "signature">; networkFeeWei: bigint; gas: OperationGas }> {
  const estimated = await estimateOperation(args);
  return {
    gas: estimated.gas,
    networkFeeWei: estimated.networkFeeWei,
    op: buildUserOp({
      sender: args.op.sender,
      nonce: args.op.nonce,
      callData: args.op.callData,
      initCode: args.op.initCode,
      keyType: args.keyType,
      gas: estimated.gas,
    }),
  };
}

async function jsonRpc(url: string, method: string, params: unknown[], chainName?: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (response.status === 429) throw new Error(explainBundlerError("429", chainName));
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(explainBundlerError(body.error.message, chainName));
  return body.result;
}

export function explainBundlerError(message: string | undefined, chain?: string): string {
  const network = chain?.trim() || "this chain";
  const text = message ?? "";
  if (/entry ?point version 0\.9 is not currently enabled/i.test(text)) {
    return "This bundler does not run EntryPoint 0.9. KNOAD sends need a bundler that does.";
  }
  if (/\b429\b|rate limit|too many requests/i.test(text)) {
    return "The bundler is busy. Try again in a moment.";
  }
  if (/\bAA21\b|prefund/i.test(text)) {
    return `Not enough ETH on ${network} for the network fee.`;
  }
  if (/\bAA25\b|invalid nonce/i.test(text)) {
    return `Another send from this account is waiting on ${network}.`;
  }
  if (/\bAA20\b|\bAA13\b|\bAA10\b/.test(text)) {
    return `This account is not set up on ${network} yet. Send again.`;
  }
  return message ?? "RPC request failed.";
}

/** The bundler's own text, even after it has been turned into a sentence. */
export class BundlerRefusal extends Error {
  readonly raw: string;
  constructor(raw: string, chainName?: string) {
    super(explainBundlerError(raw, chainName));
    this.name = "BundlerRefusal";
    this.raw = raw;
  }
}

export function refusalText(error: unknown): string {
  if (error instanceof BundlerRefusal) return error.raw;
  return error instanceof Error ? error.message : "";
}

/** Reads `must be at least N` for the tip, the max fee, or both. N is decimal wei. */
export function feeMinimum(message: string): { maxPriorityFeePerGas?: bigint; maxFeePerGas?: bigint } | null {
  const priority = /maxPriorityFeePerGas must be at least (\d+)/i.exec(message);
  const maxFee = /maxFeePerGas must be at least (\d+)/i.exec(message);
  if (!priority && !maxFee) return null;
  return {
    ...(priority ? { maxPriorityFeePerGas: BigInt(priority[1]!) } : {}),
    ...(maxFee ? { maxFeePerGas: BigInt(maxFee[1]!) } : {}),
  };
}

function bumpTenPercent(value: bigint): bigint {
  const raised = (value * 11n) / 10n;
  return raised > value ? raised : value + 1n;
}

/** The stated minimum plus 10%. Gas limits stay. Max fee stays at least the tip. */
export function gasAboveMinimum(
  gas: OperationGas,
  minimum: { maxPriorityFeePerGas?: bigint; maxFeePerGas?: bigint },
): OperationGas {
  const next = { ...gas };
  if (minimum.maxPriorityFeePerGas !== undefined) next.maxPriorityFeePerGas = bumpTenPercent(minimum.maxPriorityFeePerGas);
  if (minimum.maxFeePerGas !== undefined) next.maxFeePerGas = bumpTenPercent(minimum.maxFeePerGas);
  if (next.maxFeePerGas < next.maxPriorityFeePerGas) next.maxFeePerGas = next.maxPriorityFeePerGas;
  return next;
}

export function operationGas(op: Omit<PackedUserOperation, "signature">): OperationGas {
  const [verificationGasLimit, callGasLimit] = splitUint128(op.accountGasLimits);
  const [maxPriorityFeePerGas, maxFeePerGas] = splitUint128(op.gasFees);
  return {
    verificationGasLimit,
    callGasLimit,
    preVerificationGas: op.preVerificationGas,
    maxPriorityFeePerGas,
    maxFeePerGas,
  };
}

/**
 * Submits once. A fee-too-low refusal is re-signed at the stated minimum plus
 * 10% and submitted once more. A second refusal is returned as-is.
 */
export async function submitPriced(args: {
  op: PackedUserOperation;
  submit: (op: PackedUserOperation) => Promise<string>;
  resign: (gas: OperationGas) => Promise<PackedUserOperation>;
  gas?: OperationGas;
}): Promise<{ hash: string; op: PackedUserOperation }> {
  try {
    return { hash: await args.submit(args.op), op: args.op };
  } catch (error) {
    const minimum = feeMinimum(refusalText(error));
    if (!minimum) throw error;
    const resigned = await args.resign(gasAboveMinimum(args.gas ?? operationGas(args.op), minimum));
    return { hash: await args.submit(resigned), op: resigned };
  }
}

function splitUint128(packed: Hex): readonly [bigint, bigint] {
  const body = packed.slice(2).padStart(64, "0");
  return [BigInt(`0x${body.slice(0, 32)}`), BigInt(`0x${body.slice(32)}`)];
}

function asBigint(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && (value.startsWith("0x") || /^\d+$/.test(value))) return BigInt(value);
  throw new Error("Gas value was not a number.");
}
