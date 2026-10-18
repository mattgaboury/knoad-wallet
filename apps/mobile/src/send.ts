import {
  buildUserOp,
  deployments,
  encodeTypedDataSignature,
  erc7739TypedData,
  executeAndRotateCalldata,
  hotKeyTypeForChain,
  InflightQueue,
  parseTypedDataRequest,
  personalSignDigest,
  prepareRotation,
  assertCallGas,
  operationGas,
  quoteOperationGas,
  BundlerRefusal,
  submitPriced as submitAtFee,
  serializeUserOperation,
  signSecp256k1,
  userOpHash,
  type Address,
  type Call,
  type Hex,
  type HotKeystore,
  type KeyType,
  type OperationGas,
  type PackedUserOperation,
  type WriteAheadLog,
} from "@knoad/wallet-core";

const inflight = new InflightQueue();

export async function signRotatingOperation(args: {
  account: Address;
  chainId: number;
  generation: bigint;
  initCode?: Hex;
  calls: Call[];
  keystore: HotKeystore;
  wal: WriteAheadLog;
  currentKeyType: KeyType;
  signCurrent: (digest: Hex) => Promise<Hex>;
  gas?: OperationGas;
  chainName?: string;
  bundlerUrl?: string | null;
  rpcUrl?: string | null;
}): Promise<PackedUserOperation> {
  inflight.begin();
  try {
    let prepared;
    try {
      prepared = await args.wal.requirePrepared(args.account, args.chainId, args.generation);
    } catch (error) {
      const missing = error instanceof Error && /Write-ahead missing|does not match/.test(error.message);
      if (!missing) throw error;
      await prepareRotation({
        account: args.account,
        chainId: args.chainId,
        generation: args.generation,
        keystore: args.keystore,
        wal: args.wal,
        keyType: hotKeyTypeForChain(args.chainId),
      });
      prepared = await args.wal.requirePrepared(args.account, args.chainId, args.generation);
    }
    const callData = executeAndRotateCalldata({
      calls: args.calls,
      nextSigner: prepared.nextSigner,
      nextKeyType: prepared.nextKeyType,
    });
    const draft = buildUserOp({
      sender: args.account,
      nonce: args.generation,
      callData,
      keyType: args.currentKeyType,
      initCode: args.initCode ?? "0x",
      gas: args.gas,
    });
    const unsigned =
      args.gas || !args.bundlerUrl || !args.rpcUrl
        ? draft
        : (
            await quoteOperationGas({
              bundlerUrl: args.bundlerUrl,
              rpcUrl: args.rpcUrl,
              op: draft,
              calls: args.calls,
              keyType: args.currentKeyType,
              chainName: args.chainName,
            })
          ).op;
    assertCallGas(operationGas(unsigned), args.calls);
    const signature = await args.signCurrent(userOpHash(unsigned, BigInt(args.chainId)));
    return { ...unsigned, signature };
  } finally {
    inflight.end();
  }
}

export async function signPersonal(args: {
  account: Address;
  chainId: number;
  message: string;
  signCurrent: (digest: Hex) => Promise<Hex>;
}): Promise<Hex> {
  return args.signCurrent(personalSignDigest(args.account, BigInt(args.chainId), args.message));
}

export async function signTypedData(args: {
  account: Address;
  chainId: number;
  typedDataJson: string;
  signCurrent: (digest: Hex) => Promise<Hex>;
}): Promise<Hex> {
  const request = parseTypedDataRequest(args.typedDataJson);
  if (!request) throw new Error("Could not read the typed data.");
  const wrapped = erc7739TypedData({ account: args.account, chainId: BigInt(args.chainId), typedData: request });
  const raw = await args.signCurrent(wrapped.digest);
  return encodeTypedDataSignature({
    signature: raw,
    appSeparator: wrapped.appSeparator,
    contentsHash: wrapped.contentsHash,
    contentsDescr: wrapped.contentsDescr,
  });
}

async function postUserOperation(bundlerRpc: string, op: PackedUserOperation): Promise<string> {
  const response = await fetch(bundlerRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendUserOperation",
      params: [serializeUserOperation(op), deployments.entryPoint],
    }),
  });
  if (response.status === 429) throw new Error("429");
  let body: { result?: string; error?: { message?: string } } = {};
  try {
    body = (await response.json()) as { result?: string; error?: { message?: string } };
  } catch {
    throw new Error(response.status === 429 ? "429" : "Bundler rejected the operation.");
  }
  if (!body.result) throw new Error(body.error?.message || "Bundler rejected the operation.");
  return body.result;
}

/**
 * Submits the signed operation. If the bundler names a higher tip or max fee,
 * re-signs once at that minimum plus 10% with the same next key.
 */
export async function submitPriced(args: {
  bundlerUrl: string;
  op: PackedUserOperation;
  chainName?: string;
  resign: (gas: OperationGas) => Promise<PackedUserOperation>;
}): Promise<{ hash: string; op: PackedUserOperation }> {
  try {
    return await submitAtFee({
      op: args.op,
      resign: args.resign,
      submit: (op) => postUserOperation(args.bundlerUrl, op),
    });
  } catch (error) {
    const raw = error instanceof BundlerRefusal ? error.raw : error instanceof Error ? error.message : "Bundler rejected the operation.";
    throw new BundlerRefusal(raw, args.chainName);
  }
}

export async function submitUserOperation(bundlerRpc: string, op: PackedUserOperation, chainName?: string): Promise<string> {
  try {
    return await postUserOperation(bundlerRpc, op);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Bundler rejected the operation.";
    throw new BundlerRefusal(raw, chainName);
  }
}

export function secpSigner(privateKey: Hex): (digest: Hex) => Promise<Hex> {
  return (digest) => signSecp256k1(privateKey, digest);
}
