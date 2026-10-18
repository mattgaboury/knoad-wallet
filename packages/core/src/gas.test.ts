import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, type Address, type Hex } from "viem";
import { buildUserOp, packUint128Pair, userOpHash } from "./account";
import { readFileSync } from "node:fs";
import { deployments } from "./deployments";
import { EXECUTE_OVERHEAD, ESTIMATOR, SIGNATURE_VERIFICATION_GAS, assertCallGas, bufferedGas, defaultTestGas, estimateOperation, explainBundlerError, operationGas, submitPriced, type RpcCaller } from "./gas";
import { KEY_P256 } from "./types";

test("a bundler that refuses EntryPoint 0.9 is named as such", () => {
  assert.equal(
    explainBundlerError("EntryPoint version 0.9 is not currently enabled"),
    "This bundler does not run EntryPoint 0.9. KNOAD sends need a bundler that does.",
  );
  assert.equal(
    explainBundlerError("AA20 account not deployed", "Base Sepolia"),
    "This account is not set up on Base Sepolia yet. Send again.",
  );
});

test("the estimator fixture is the compiled simulation contract", () => {
  const artifact = JSON.parse(readFileSync("out/KnoadEstimator.sol/KnoadEstimator.json", "utf8")) as { deployedBytecode: { object: string } };
  assert.equal(ESTIMATOR.runtimeCode, artifact.deployedBytecode.object);
});

test("estimation refuses a chain without the implementation", async () => {
  const rpc: RpcCaller = async (_url, method) => {
    if (method === "eth_getCode") return "0x";
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(
    estimateOperation({ bundlerUrl: "http://bundler", rpcUrl: "http://rpc", op: buildUserOp({ sender: getAddress("0x00000000000000000000000000000000000000aa"), nonce: 0n, callData: "0x" }), rpc }),
    /implementation is not deployed/,
  );
});

test("buildUserOp keeps the fixture gas when no estimate is passed", () => {
  const op = buildUserOp({
    sender: getAddress("0x00000000000000000000000000000000000000aa"),
    nonce: 0n,
    callData: "0x010203",
  });
  const gas = defaultTestGas();
  assert.equal(op.preVerificationGas, gas.preVerificationGas);
  assert.equal(op.gasFees, packUint128Pair(gas.maxPriorityFeePerGas, gas.maxFeePerGas));
  assert.equal(op.accountGasLimits, packUint128Pair(gas.verificationGasLimit, gas.callGasLimit));
});

test("a P-256 operation asks for the larger verification limit", () => {
  const op = buildUserOp({
    sender: getAddress("0x00000000000000000000000000000000000000aa"),
    nonce: 0n,
    callData: "0x",
    keyType: KEY_P256,
  });
  const gas = defaultTestGas(KEY_P256);
  assert.equal(op.accountGasLimits, packUint128Pair(gas.verificationGasLimit, gas.callGasLimit));
});

test("estimation uses the bundler limits and the live base fee", async () => {
  let override: Record<string, { code: Hex }> | undefined;
  const rpc: RpcCaller = async (_url, method, params) => {
    if (method === "eth_getCode") return "0x6001";
    if (method === "eth_estimateUserOperationGas") {
      override = params[2] as Record<string, { code: Hex }>;
      return { preVerificationGas: "0x186a0", verificationGasLimit: "0x186a0", callGasLimit: "0x30d40" };
    }
    if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x3b9aca00" };
    if (method === "eth_maxPriorityFeePerGas") return "0x5f5e100";
    throw new Error(method);
  };
  const draft = buildUserOp({
    sender: getAddress("0x00000000000000000000000000000000000000aa"),
    nonce: 1n,
    callData: "0x1234" as Hex,
  });
  const estimated = await estimateOperation({
    bundlerUrl: "http://bundler",
    rpcUrl: "http://rpc",
    op: draft,
    rpc,
  });
  assert.equal(estimated.gas.callGasLimit, (200_000n * 12_000n) / 10_000n);
  assert.equal(estimated.gas.verificationGasLimit, ((100_000n + SIGNATURE_VERIFICATION_GAS) * 12_000n) / 10_000n);
  assert.equal(override?.[deployments.implementation]?.code, ESTIMATOR.runtimeCode);
  assert.equal(override?.[ESTIMATOR.shadow]?.code, "0x6001");
  assert.equal(estimated.gas.maxPriorityFeePerGas, 100_000_000n);
  assert.equal(estimated.gas.maxFeePerGas, 1_000_000_000n * 2n + 100_000_000n);
  assert.equal(
    estimated.networkFeeWei,
    (estimated.gas.preVerificationGas + estimated.gas.verificationGasLimit + estimated.gas.callGasLimit) * estimated.gas.maxFeePerGas,
  );
  const hashed = userOpHash({ ...draft, sender: draft.sender as Address }, 1n);
  assert.equal(hashed.startsWith("0x"), true);
});

const sender = getAddress("0x00000000000000000000000000000000000000aa");

function limits(extra: (method: string) => unknown): RpcCaller {
  return async (_url, method) => {
    if (method === "eth_getCode") return "0x6001";
    if (method === "eth_estimateUserOperationGas") return { preVerificationGas: "0x1", verificationGasLimit: "0x1", callGasLimit: "0x1" };
    if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x3b9aca00" };
    return extra(method);
  };
}

test("a payment below the overhead floor is refused before it is signed", () => {
  const low = { ...defaultTestGas(), callGasLimit: 23_760n };
  const call = { target: sender, value: 1n, data: "0x" as const };
  assert.throws(() => assertCallGas(low, [call]), /could not be sized/);
  assert.doesNotThrow(() => assertCallGas(low, []));
  assert.doesNotThrow(() => assertCallGas({ ...low, callGasLimit: bufferedGas(EXECUTE_OVERHEAD) }, [call]));
});

test("a bundler call gas of 19800 loses to the payment floor", async () => {
  const rpc: RpcCaller = async (_url, method) => {
    if (method === "eth_getCode") return "0x6001";
    if (method === "eth_estimateUserOperationGas") return { preVerificationGas: "0x186a0", verificationGasLimit: "0x186a0", callGasLimit: "0x4d58" };
    if (method === "eth_estimateGas") return "0x52e4";
    if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x1" };
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    throw new Error(method);
  };
  const estimated = await estimateOperation({
    bundlerUrl: "http://bundler",
    rpcUrl: "http://rpc",
    op: buildUserOp({ sender, nonce: 1n, callData: "0x" }),
    calls: [{ target: sender, value: 100_000_000_000_000n, data: "0x" }],
    rpc,
  });
  assert.equal(estimated.gas.callGasLimit, bufferedGas(EXECUTE_OVERHEAD + 21_220n));
  assert.ok(estimated.gas.callGasLimit > 23_760n);
});

test("the bundler tip wins over a lower chain tip", async () => {
  const rpc = limits((method) => {
    if (method === "eth_maxPriorityFeePerGas") return "0xf4240";
    if (method === "pimlico_getUserOperationGasPrice") {
      return { fast: { maxPriorityFeePerGas: "1150000", maxFeePerGas: "5000000000" } };
    }
    throw new Error(method);
  });
  const estimated = await estimateOperation({
    bundlerUrl: "http://bundler",
    rpcUrl: "http://rpc",
    op: buildUserOp({ sender, nonce: 1n, callData: "0x" }),
    rpc,
  });
  assert.equal(estimated.gas.maxPriorityFeePerGas, 1_150_000n);
  assert.equal(estimated.gas.maxFeePerGas, 5_000_000_000n);
});

test("a missing Pimlico method falls back to Rundler, then the chain", async () => {
  const rundler = limits((method) => {
    if (method === "eth_maxPriorityFeePerGas") return "0xf4240";
    if (method === "pimlico_getUserOperationGasPrice") throw new Error("method not found");
    if (method === "rundler_maxPriorityFeePerGas") return "0x1e8480";
    throw new Error(method);
  });
  const fromRundler = await estimateOperation({
    bundlerUrl: "http://bundler",
    rpcUrl: "http://rpc",
    op: buildUserOp({ sender, nonce: 1n, callData: "0x" }),
    rpc: rundler,
  });
  assert.equal(fromRundler.gas.maxPriorityFeePerGas, 2_000_000n);

  const chain = limits((method) => {
    if (method === "eth_maxPriorityFeePerGas") return "0xf4240";
    if (method === "pimlico_getUserOperationGasPrice" || method === "rundler_maxPriorityFeePerGas") throw new Error("method not found");
    throw new Error(method);
  });
  const fromChain = await estimateOperation({
    bundlerUrl: "http://bundler",
    rpcUrl: "http://rpc",
    op: buildUserOp({ sender, nonce: 1n, callData: "0x" }),
    rpc: chain,
  });
  assert.equal(fromChain.gas.maxPriorityFeePerGas, 1_000_000n);
  assert.equal(fromChain.gas.maxFeePerGas, 1_000_000_000n * 2n + 1_000_000n);
});

test("submitPriced reads the stated minimum, re-signs once, and stops", async () => {
  const message =
    "maxPriorityFeePerGas must be at least 1150000 (current maxPriorityFeePerGas: 1000000) - use pimlico_getUserOperationGasPrice to get the current gas price";
  const gas = { ...defaultTestGas(), maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: 3_000_000n };
  const op = { ...buildUserOp({ sender, nonce: 1n, callData: "0x", gas }), signature: "0x01" as Hex };
  let submits = 0;
  let resigns = 0;
  await assert.rejects(
    submitPriced({
      op,
      gas,
      submit: async () => {
        submits += 1;
        throw new Error(message);
      },
      resign: async (next) => {
        resigns += 1;
        assert.equal(next.maxPriorityFeePerGas, (1_150_000n * 11n) / 10n);
        assert.equal(next.maxFeePerGas, 3_000_000n);
        return { ...buildUserOp({ sender, nonce: 1n, callData: "0x", gas: next }), signature: "0x02" as Hex };
      },
    }),
    /must be at least 1150000/,
  );
  assert.equal(resigns, 1);
  assert.equal(submits, 2);
});

test("operationGas reads the packed fields", () => {
  const gas = {
    verificationGasLimit: 11n,
    callGasLimit: 22n,
    preVerificationGas: 33n,
    maxPriorityFeePerGas: 44n,
    maxFeePerGas: 55n,
  };
  const op = buildUserOp({ sender, nonce: 1n, callData: "0x", gas });
  assert.deepEqual(operationGas(op), gas);
});

test("bundler refusals become one sentence each", () => {
  const chain = "Base Sepolia";
  assert.equal(explainBundlerError("AA21 didn't pay prefund", chain), "Not enough ETH on Base Sepolia for the network fee.");
  assert.equal(explainBundlerError("account didn't pay prefund", chain), "Not enough ETH on Base Sepolia for the network fee.");
  assert.equal(explainBundlerError("AA25 invalid account nonce", chain), "Another send from this account is waiting on Base Sepolia.");
  assert.equal(explainBundlerError("invalid nonce", chain), "Another send from this account is waiting on Base Sepolia.");
  assert.equal(explainBundlerError("AA13 initCode failed or OOG", chain), "This account is not set up on Base Sepolia yet. Send again.");
  assert.equal(explainBundlerError("AA10 sender already constructed", chain), "This account is not set up on Base Sepolia yet. Send again.");
  assert.equal(explainBundlerError("429 Too Many Requests", chain), "The bundler is busy. Try again in a moment.");
  assert.equal(explainBundlerError("rate limit exceeded"), "The bundler is busy. Try again in a moment.");
  assert.equal(explainBundlerError("execution reverted"), "execution reverted");
});
