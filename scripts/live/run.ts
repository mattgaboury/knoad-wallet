import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEY_P256, KEY_SECP256K1, createP256Key, deployments, signP256, type Address, type Hex } from "@knoad/wallet-core";
import { concat, encodeFunctionData, getAddress, getCreateAddress } from "viem";
import { jsonRpc, runLiveScenarios } from "../../packages/live/src/scenarios.ts";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const RPC_PORT = 18545;
const BUNDLER_PORT = 14337;
const rpcUrl = `http://127.0.0.1:${RPC_PORT}`;
const bundlerUrl = `http://127.0.0.1:${BUNDLER_PORT}`;

/** Anvil's published development accounts. They never leave this local process. */
const FUNDER = getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const FUNDER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXECUTOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const UTILITY_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const DEPLOYER_CODE =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

const children: ChildProcess[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inspect(contract: string): Hex {
  return execFileSync("forge", ["inspect", contract, "bytecode"], {
    cwd: root,
    encoding: "utf8",
  }).trim() as Hex;
}

async function waitFor(url: string, method: string, label: string): Promise<void> {
  let last = "not up";
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await jsonRpc(url, method, []);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : "not up";
      await delay(250);
    }
  }
  throw new Error(`${label} did not answer ${method}: ${last}`);
}

async function deploy(from: Address, bytecode: Hex): Promise<Address> {
  const hash = (await jsonRpc(rpcUrl, "eth_sendTransaction", [{ from, data: bytecode, gas: "0x800000" }])) as Hex;
  for (let attempt = 0; attempt < 40; attempt++) {
    const receipt = (await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [hash])) as {
      status?: string;
      contractAddress?: string;
    } | null;
    if (receipt) {
      if (receipt.status !== "0x1" || !receipt.contractAddress) throw new Error(`Deploy failed: ${hash}`);
      return getAddress(receipt.contractAddress);
    }
    await delay(200);
  }
  throw new Error(`Deploy was not mined: ${hash}`);
}

async function readAddress(to: Address, name: "senderCreator" | "entryPoint"): Promise<Address> {
  const data = encodeFunctionData({
    abi: [{ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
    functionName: name,
  });
  const result = (await jsonRpc(rpcUrl, "eth_call", [{ to, data }, "latest"])) as Hex;
  return getAddress(`0x${result.slice(-40)}`);
}

function replaceAddress(code: Hex, from: Address, to: Address): Hex {
  const body = code.slice(2).toLowerCase();
  const needle = from.slice(2).toLowerCase();
  const next = to.slice(2).toLowerCase();
  if (!body.includes(needle)) throw new Error("EntryPoint code did not contain its sender creator.");
  return `0x${body.replaceAll(needle, next)}`;
}

async function installEntryPoint(): Promise<void> {
  const canonical = deployments.entryPoint;
  const temporary = await deploy(FUNDER, inspect("EntryPoint"));
  const temporaryCode = (await jsonRpc(rpcUrl, "eth_getCode", [temporary, "latest"])) as Hex;
  const originalCreator = await readAddress(temporary, "senderCreator");
  await jsonRpc(rpcUrl, "anvil_impersonateAccount", [canonical]);
  await jsonRpc(rpcUrl, "anvil_setBalance", [canonical, "0x3635C9ADC5DEA00000"]);
  // Alto's bundle check looks up the creator at the address a real EntryPoint
  // constructor would have created (nonce 1). Deploy the local creator there.
  await jsonRpc(rpcUrl, "anvil_setNonce", [canonical, "0x1"]);
  const trusted = await deploy(canonical, inspect("SenderCreator"));
  const expected = getAddress(getCreateAddress({ from: canonical, nonce: 1n }));
  if (trusted !== expected) throw new Error(`Sender creator ${trusted} is not at ${expected}.`);
  await jsonRpc(rpcUrl, "anvil_setCode", [canonical, replaceAddress(temporaryCode, originalCreator, trusted)]);
  const bound = await readAddress(canonical, "senderCreator");
  const point = await readAddress(trusted, "entryPoint");
  if (bound !== trusted) throw new Error("Canonical EntryPoint is not using the local sender creator.");
  if (point !== canonical) throw new Error("Sender creator does not accept the canonical EntryPoint.");
}

async function precompileWorks(): Promise<boolean> {
  const key = createP256Key();
  const digest = `0x${"ab".repeat(32)}` as Hex;
  const input = concat([digest, signP256(key.privateKey, digest)]);
  const result = (await jsonRpc(rpcUrl, "eth_call", [
    { to: "0x0000000000000000000000000000000000000100", data: input },
    "latest",
  ])) as string;
  return result !== "0x" && result !== "0x0" && BigInt(result) === 1n;
}

function stopChildren(): void {
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill("SIGTERM");
  }
}

function patchAltoBundle(): void {
  const mempool = join(root, "node_modules/@pimlico/alto/esm/mempool/mempool.js");
  const source = readFileSync(mempool, "utf8");
  if (source.includes("bundleUserOps")) return;
  const signature = "async shouldSkip({ userOpInfo, paymasterDeposit, touchedEip7702Auth, stakedEntityCount, knownEntities, senders, storageMap, entryPoint }) {";
  const queued = `let queuedUserOps = [];
            if (!isUserOpV06) {
                queuedUserOps = await this.getQueuedOutstandingUserOps({
                    userOp,
                    entryPoint
                });
            }`;
  const call = `const skipResult = await this.shouldSkip({
                    userOpInfo: currentUserOp,
                    touchedEip7702Auth,
                    paymasterDeposit,
                    stakedEntityCount,
                    knownEntities,
                    senders,
                    storageMap,
                    entryPoint
                });`;
  if (!source.includes(signature) || !source.includes(queued) || !source.includes(call)) {
    throw new Error("Alto mempool did not match the expected bundle validation.");
  }
  writeFileSync(
    mempool,
    source
      .replace(
        signature,
        "async shouldSkip({ userOpInfo, paymasterDeposit, touchedEip7702Auth, stakedEntityCount, knownEntities, senders, storageMap, entryPoint, bundleUserOps = [] }) {",
      )
      .replace(
        queued,
        `let queuedUserOps = [];
            if (!isUserOpV06) {
                queuedUserOps = [
                    ...bundleUserOps.map((info) => info.userOp),
                    ...await this.getQueuedOutstandingUserOps({
                        userOp,
                        entryPoint
                    })
                ];
            }`,
      )
      .replace(call, call.replace("entryPoint\n                });", "entryPoint,\n                    bundleUserOps: currentBundle.userOps\n                });")),
  );
}

function patchAltoSafeValidator(): void {
  const file = join(root, "node_modules/@pimlico/alto/esm/rpc/validation/SafeValidator.js");
  const source = readFileSync(file, "utf8");
  if (source.includes("Accept whichever frame decodes")) return;
  const needle = `        const lastResult = tracerResult.calls.slice(-1)[0];
        if (lastResult.type !== "REVERT") {
            throw new Error("Invalid response. simulateCall must revert");
        }
        const resultData = lastResult.data;
        // Decode the validation result from the revert data
        const { errorName, args } = decodeErrorResult({
            abi: pimlicoSimulationsAbi,
            data: resultData
        });
        if (errorName !== "ValidationResult") {
            let errorCode = ERC7769Errors.SimulateValidation;
            const errorMessage = errorName || "Unknown validation error";
            if (errorMessage.includes("AA24")) {
                errorCode = ERC7769Errors.InvalidSignature;
            }
            if (errorMessage.includes("AA31")) {
                errorCode = ERC7769Errors.PaymasterDepositTooLow;
            }
            throw new RpcError(errorMessage, errorCode);
        }
        const validationResult = args[0];`;
  const replacement = `        // Anvil records the simulations call as a successful return. Geth records the
        // same result as a ValidationResult revert. Accept whichever frame decodes.
        const frames = [...tracerResult.calls].reverse().filter((frame) => (frame.type === "RETURN" || frame.type === "REVERT") &&
            typeof frame.data === "string" &&
            frame.data.length > 10);
        let validationResult;
        let revertError = null;
        const decodeNotes = [];
        for (const frame of frames) {
            if (frame.type === "RETURN") {
                try {
                    const decoded = decodeFunctionResult({
                        abi: pimlicoSimulationsAbi,
                        functionName: "simulateValidation",
                        data: frame.data
                    });
                    const candidate = decoded?.returnInfo ? decoded : decoded?.[0];
                    if (candidate?.returnInfo) {
                        validationResult = candidate;
                        break;
                    }
                }
                catch (error) {
                    decodeNotes.push(error instanceof Error ? error.message : "return decode failed");
                }
                continue;
            }
            try {
                const decoded = decodeErrorResult({
                    abi: [...pimlicoSimulationsAbi, ...simulationErrors],
                    data: frame.data
                });
                if (decoded.errorName === "ValidationResult") {
                    validationResult = decoded.args[0];
                    break;
                }
                const reason = decoded.errorName === "FailedOp" || decoded.errorName === "FailedOpWithRevert"
                    ? \`\${decoded.errorName}(\${decoded.args?.[1] ?? ""})\`
                    : decoded.errorName || "Unknown validation error";
                let errorCode = ERC7769Errors.SimulateValidation;
                if (reason.includes("AA24")) {
                    errorCode = ERC7769Errors.InvalidSignature;
                }
                if (reason.includes("AA31")) {
                    errorCode = ERC7769Errors.PaymasterDepositTooLow;
                }
                revertError = new RpcError(reason, errorCode);
            }
            catch (error) {
                if (error instanceof RpcError)
                    revertError = error;
                else
                    decodeNotes.push(error instanceof Error ? error.message : "revert decode failed");
            }
        }
        if (!validationResult) {
            if (revertError)
                throw revertError;
            const tail = frames.slice(0, 6).map((frame) => \`\${frame.type}:\${frame.data.slice(0, 10)}:\${frame.data.length}\`).join(" ");
            throw new Error(\`Invalid response. simulateCall must revert (\${tail}) \${decodeNotes[0] ?? ""}\`);
        }`;
  if (!source.includes(needle)) throw new Error("Alto SafeValidator did not match the expected decode.");
  let next = source.replace(needle, replacement);
  next = next.replace(
    'import { decodeErrorResult, encodeDeployData, encodeFunctionData, zeroAddress } from "viem";',
    'import { decodeErrorResult, decodeFunctionResult, encodeDeployData, encodeFunctionData, zeroAddress } from "viem";',
  );
  if (!next.includes('import { simulationErrors }')) {
    next = next.replace(
      'import { debug_traceCall } from "./tracer.js";',
      'import { debug_traceCall } from "./tracer.js";\nimport { simulationErrors } from "../estimation/utils.js";',
    );
  }
  writeFileSync(file, next);
}

function patchAltoTracer(): void {
  const tracer = join(root, "node_modules/@pimlico/alto/esm/rpc/validation/BundlerCollectorTracerV07.js");
  const source = readFileSync(tracer, "utf8");
  if (source.includes("earlyOp")) return;
  const needle = `        step(log, db) {
            if (log.getDepth() < 3) {
                return;
            }`;
  const patched = `        step(log, db) {
            if (log.getDepth() < 3) {
                const earlyOp = log.op.toString();
                if (earlyOp === "REVERT" || earlyOp === "RETURN") {
                    const earlyOfs = Number.parseInt(log.stack.peek(0).toString());
                    const earlyLen = Number.parseInt(log.stack.peek(1).toString());
                    const earlyData = toHex(log.memory.slice(earlyOfs, earlyOfs + earlyLen)).slice(0, 32000);
                    this.calls.push({
                        type: earlyOp,
                        gasUsed: 0,
                        data: earlyData
                    });
                }
                return;
            }`;
  if (!source.includes(needle)) throw new Error("Alto tracer did not match the expected depth check.");
  writeFileSync(tracer, source.replace(needle, patched));
}

async function main(): Promise<void> {
  patchAltoTracer();
  patchAltoBundle();
  patchAltoSafeValidator();
  mkdirSync(join(root, "test-vectors"), { recursive: true });
  const anvilLog = createWriteStream("/tmp/knoad-anvil.log");
  const altoLog = createWriteStream("/tmp/knoad-alto.log");
  const anvil = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(RPC_PORT),
      "--chain-id",
      "31337",
      "--hardfork",
      "cancun",
      "--base-fee",
      "1000000000",
      "--gas-limit",
      "30000000",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  anvil.stdout?.pipe(anvilLog);
  anvil.stderr?.pipe(anvilLog);
  children.push(anvil);
  await waitFor(rpcUrl, "eth_chainId", "anvil");

  await jsonRpc(rpcUrl, "anvil_setCode", [deployments.deterministicDeployer, DEPLOYER_CODE]);
  await installEntryPoint();
  execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", rpcUrl, "--broadcast"], {
    cwd: root,
    env: { ...process.env, DEPLOYER_PRIVATE_KEY: FUNDER_KEY },
    stdio: "inherit",
  });
  const factoryCode = (await jsonRpc(rpcUrl, "eth_getCode", [deployments.factory, "latest"])) as string;
  if (factoryCode === "0x") throw new Error("The factory was not deployed at its deterministic address.");
  const sink = await deploy(FUNDER, inspect("Sink"));
  const p256 = await precompileWorks();

  const alto = spawn(
    join(root, "node_modules/.bin/alto"),
    [
      `--entrypoints=${deployments.entryPoint}`,
      `--executor-private-keys=${EXECUTOR_KEY}`,
      `--utility-private-key=${UTILITY_KEY}`,
      `--rpc-url=${rpcUrl}`,
      `--port=${BUNDLER_PORT}`,
      "--safe-mode=true",
      "--bundle-mode=manual",
      "--enable-debug-endpoints=true",
      "--deploy-simulations-contract=true",
      "--refilling-wallets=false",
      "--enforce-unique-senders-per-bundle=false",
      "--mempool-max-queued-ops=10",
      "--min-entity-stake=0",
      "--min-entity-unstake-delay=0",
      "--min-executor-balance=0",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  alto.stdout?.pipe(altoLog);
  alto.stderr?.pipe(altoLog);
  children.push(alto);
  alto.on("exit", (code) => {
    if (code && code !== 0) console.error(`Alto exited ${code}. See /tmp/knoad-alto.log`);
  });
  try {
    await waitFor(bundlerUrl, "eth_supportedEntryPoints", "alto");
  } catch (error) {
    console.error(readFileSync("/tmp/knoad-alto.log", "utf8").slice(-4000));
    throw error;
  }

  const chainId = Number(BigInt((await jsonRpc(rpcUrl, "eth_chainId", [])) as string));
  const report = await runLiveScenarios({
    rpcUrl,
    bundlerUrl,
    chainId,
    sink,
    funder: FUNDER,
    laterKeyType: p256 ? KEY_P256 : KEY_SECP256K1,
    p256Note: p256
      ? "The 0x100 precompile verified a signature on this Cancun anvil, so later keys were P-256."
      : "Anvil 1.5 on Cancun does not serve the P-256 precompile at 0x100. The scenarios used secp256k1 keys. P-256 was not tested live.",
  });
  const out = join(root, "test-vectors/live-report.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

process.on("SIGINT", () => {
  stopChildren();
  process.exit(1);
});

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    try {
      console.error(readFileSync("/tmp/knoad-alto.log", "utf8").slice(-2000));
    } catch {
      // Alto may not have started.
    }
    process.exitCode = 1;
  })
  .finally(() => {
    stopChildren();
  });
