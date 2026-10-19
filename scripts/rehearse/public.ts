import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  KEY_SECP256K1,
  accountAbi,
  buildRecoveryRequest,
  buildUserOp,
  deployments,
  deriveRecovery,
  executeAndRotateCalldata,
  firstUseDraft,
  generateRecoveryMnemonic,
  memoryKv,
  predictDeployedAccount,
  prepareActivations,
  quoteOperationGas,
  recoveryDigest,
  serializeUserOperation,
  signSecp256k1,
  softwareHotKeystore,
  submitPriced,
  userOpHash,
  type Address,
  type Hex,
  type OperationGas,
  type PackedUserOperation,
} from "@knoad/wallet-core";
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import { broadcastRecovery } from "../../packages/cli/src/commands.ts";
import { assertRehearsalChain } from "./guard.ts";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fileEnv = loadEnvFiles([join(root, ".env"), join(root, "apps/mobile/.env")]);

type Receipt = { userOpHash: string; txHash: string; success: boolean };

type Report = {
  chainId: number;
  account: Address;
  firstSend: Receipt;
  secondSend: Receipt;
  retiredKeyRejected: true;
  oldActivationRejected: true;
  recovery: { txHash: string };
  previousKeyRejected: true;
};

const chains = {
  84532: baseSepolia,
  11155111: sepolia,
} as const;

function loadEnvFiles(paths: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const path of paths) {
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !(key in values)) values[key] = value;
    }
  }
  return values;
}

function envValue(name: string): string {
  return (process.env[name] ?? fileEnv[name] ?? "").trim();
}

function scrub(error: unknown): string {
  const message = error instanceof Error ? error.message : "Rehearsal failed.";
  return message.replace(/https?:\/\/\S+/g, "[url]");
}

function endpoint(chainId: number, kind: "RPC" | "BUNDLER", shared: boolean): string {
  if (shared) {
    const override = envValue(`KNOAD_REHEARSE_${kind}`);
    if (override) return override;
  }
  const named = envValue(`EXPO_PUBLIC_KNOAD_${kind}_${chainId}`);
  if (named) return named;
  if (kind === "RPC" && chainId === 84532) return envValue("BASE_SEPOLIA_RPC_URL");
  if (kind === "RPC" && chainId === 11155111) return envValue("SEPOLIA_RPC_URL");
  return "";
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC request failed.");
  return body.result;
}

function fallbackGas(deploying: boolean): OperationGas {
  return {
    verificationGasLimit: deploying ? 3_000_000n : 1_500_000n,
    callGasLimit: 800_000n,
    preVerificationGas: deploying ? 500_000n : 150_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    maxFeePerGas: 2_000_000_000n,
  };
}

async function price(
  bundlerUrl: string,
  rpcUrl: string,
  draft: Omit<PackedUserOperation, "signature">,
  chainName: string,
): Promise<Omit<PackedUserOperation, "signature">> {
  try {
    const quoted = await quoteOperationGas({
      bundlerUrl,
      rpcUrl,
      op: draft,
      calls: [],
      keyType: KEY_SECP256K1,
      chainName,
    });
    return quoted.op;
  } catch (error) {
    console.log(`Quote failed (${scrub(error)}). Using a fixed testnet gas limit.`);
    return buildUserOp({
      sender: draft.sender,
      nonce: draft.nonce,
      callData: draft.callData,
      initCode: draft.initCode,
      keyType: KEY_SECP256K1,
      gas: fallbackGas(draft.initCode !== "0x"),
    });
  }
}

async function submit(bundlerUrl: string, op: PackedUserOperation): Promise<string> {
  const hash = await rpc(bundlerUrl, "eth_sendUserOperation", [serializeUserOperation(op), deployments.entryPoint]);
  if (typeof hash !== "string") throw new Error("The bundler did not return an operation hash.");
  return hash;
}

async function included(bundlerUrl: string, hash: string): Promise<Receipt> {
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = (await rpc(bundlerUrl, "eth_getUserOperationReceipt", [hash])) as {
      success?: boolean;
      receipt?: { transactionHash?: string };
    } | null;
    if (result?.receipt?.transactionHash) {
      return { userOpHash: hash, txHash: result.receipt.transactionHash, success: result.success === true };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("The operation was not included.");
}

async function sendOp(args: {
  bundlerUrl: string;
  rpcUrl: string;
  chainId: number;
  chainName: string;
  draft: Omit<PackedUserOperation, "signature">;
  sign: (op: Omit<PackedUserOperation, "signature">) => Promise<Hex>;
}): Promise<Receipt> {
  const priced = await price(args.bundlerUrl, args.rpcUrl, args.draft, args.chainName);
  const op = { ...priced, signature: await args.sign(priced) };
  const sent = await submitPriced({
    op,
    submit: (next) => submit(args.bundlerUrl, next),
    resign: async (gas) => {
      const next = buildUserOp({
        sender: priced.sender,
        nonce: priced.nonce,
        callData: priced.callData,
        initCode: priced.initCode,
        keyType: KEY_SECP256K1,
        gas,
      });
      return { ...next, signature: await args.sign(next) };
    },
  });
  const receipt = await included(args.bundlerUrl, sent.hash);
  if (!receipt.success) throw new Error("The operation was included and failed.");
  return receipt;
}

async function expectRejected(bundlerUrl: string, op: PackedUserOperation): Promise<void> {
  try {
    const hash = await submit(bundlerUrl, op);
    const receipt = await included(bundlerUrl, hash);
    if (receipt.success) throw new Error("A retired key was included.");
  } catch (error) {
    const message = scrub(error);
    if (/A retired key was included|was not included|RPC request failed|fetch failed|429|AA21|prefund|not enough|insufficient/i.test(message)) {
      throw error;
    }
  }
}

async function readHot(rpcUrl: string, account: Address): Promise<Address> {
  const data = encodeFunctionData({ abi: accountAbi, functionName: "hotSigner" });
  const result = (await rpc(rpcUrl, "eth_call", [{ to: account, data }, "latest"])) as Hex;
  return getAddress(`0x${result.slice(-40)}`);
}

async function waitForHot(rpcUrl: string, account: Address, expected: Address): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await readHot(rpcUrl, account)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The spending key is ${await readHot(rpcUrl, account)}, not ${expected}.`);
}

async function rehearse(chainId: number, shared: boolean): Promise<Report> {
  assertRehearsalChain(chainId);
  const chain = chains[chainId as keyof typeof chains];
  const rpcUrl = endpoint(chainId, "RPC", shared);
  const bundlerUrl = endpoint(chainId, "BUNDLER", shared);
  const payerKey = (envValue("KNOAD_REHEARSE_PAYER_KEY") || envValue("DEPLOYER_PRIVATE_KEY")) as Hex;
  if (!rpcUrl) throw new Error(`EXPO_PUBLIC_KNOAD_RPC_${chainId} is missing.`);
  if (!bundlerUrl) throw new Error(`EXPO_PUBLIC_KNOAD_BUNDLER_${chainId} is missing.`);
  if (!payerKey || payerKey === "0x") throw new Error("KNOAD_REHEARSE_PAYER_KEY is missing.");

  const phrase = generateRecoveryMnemonic();
  const recovery = deriveRecovery(phrase, 0, 0);
  const account = predictDeployedAccount({ recovery: recovery.address });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const payer = privateKeyToAccount(payerKey);
  const wallet = createWalletClient({ account: payer, chain, transport: http(rpcUrl) });
  console.log(`${chain.name}: account ${account}`);

  const existing = await publicClient.getBytecode({ address: account });
  if (existing && existing !== "0x") throw new Error("The fresh account already has code.");

  const payerBalance = await publicClient.getBalance({ address: payer.address });
  if (payerBalance < parseEther("0.005")) {
    throw new Error(`The payer ${payer.address} needs testnet ETH on ${chain.name}.`);
  }
  const gift = payerBalance > parseEther("0.03") ? parseEther("0.02") : (payerBalance * 7n) / 10n;
  const fund = await wallet.sendTransaction({ to: account, value: gift });
  await publicClient.waitForTransactionReceipt({ hash: fund });
  console.log(`${chain.name}: funded`);

  const [activation] = await prepareActivations(phrase, account, [chainId]);
  const keys = softwareHotKeystore(memoryKv());
  const afterFirst = await keys.create("secp256k1");
  const firstSend = await sendOp({
    bundlerUrl,
    rpcUrl,
    chainId,
    chainName: chain.name,
    draft: firstUseDraft({
      account,
      chainId: BigInt(chainId),
      recovery: recovery.address,
      initialSigner: activation.initialSigner,
      initialKeyType: KEY_SECP256K1,
      activationSignature: activation.activationSignature,
      nextSigner: afterFirst.signer,
      nextKeyType: KEY_SECP256K1,
    }),
    sign: (op) => signSecp256k1(activation.initialKey, userOpHash(op, BigInt(chainId))),
  });
  await waitForHot(rpcUrl, account, afterFirst.signer);
  console.log(`${chain.name}: first send ${firstSend.userOpHash}`);

  const staleNext = await keys.create("secp256k1");
  const staleCall = firstUseDraft({
    account,
    chainId: BigInt(chainId),
    recovery: recovery.address,
    initialSigner: activation.initialSigner,
    initialKeyType: KEY_SECP256K1,
    activationSignature: activation.activationSignature,
    nextSigner: staleNext.signer,
    nextKeyType: KEY_SECP256K1,
    gas: fallbackGas(true),
  });
  await expectRejected(bundlerUrl, {
    ...staleCall,
    signature: await signSecp256k1(activation.initialKey, userOpHash(staleCall, BigInt(chainId))),
  });
  await waitForHot(rpcUrl, account, afterFirst.signer);
  console.log(`${chain.name}: old activation rejected`);

  const afterSecond = await keys.create("secp256k1");
  const secondSend = await sendOp({
    bundlerUrl,
    rpcUrl,
    chainId,
    chainName: chain.name,
    draft: buildUserOp({
      sender: account,
      nonce: 1n,
      callData: executeAndRotateCalldata({
        calls: [],
        nextSigner: afterSecond.signer,
        nextKeyType: KEY_SECP256K1,
      }),
      keyType: KEY_SECP256K1,
    }),
    sign: (op) => keys.sign(afterFirst.id, userOpHash(op, BigInt(chainId))),
  });
  await waitForHot(rpcUrl, account, afterSecond.signer);
  console.log(`${chain.name}: second send ${secondSend.userOpHash}`);

  const retiredNext = await keys.create("secp256k1");
  const retiredOp = buildUserOp({
    sender: account,
    nonce: 2n,
    callData: executeAndRotateCalldata({
      calls: [],
      nextSigner: retiredNext.signer,
      nextKeyType: KEY_SECP256K1,
    }),
    keyType: KEY_SECP256K1,
    gas: fallbackGas(false),
  });
  await expectRejected(bundlerUrl, {
    ...retiredOp,
    signature: await keys.sign(afterFirst.id, userOpHash(retiredOp, BigInt(chainId))),
  });
  await waitForHot(rpcUrl, account, afterSecond.signer);
  console.log(`${chain.name}: retired key rejected`);

  const recovered = await keys.create("secp256k1");
  const epoch = await publicClient.readContract({ address: account, abi: accountAbi, functionName: "recoveryEpoch" });
  const authorityNonce = await publicClient.readContract({ address: account, abi: accountAbi, functionName: "authorityNonce" });
  const nextRecovery = deriveRecovery(phrase, 0, Number(epoch) + 1);
  const request = buildRecoveryRequest({
    account,
    chainId: BigInt(chainId),
    newHotSigner: recovered.signer,
    newHotKeyType: KEY_SECP256K1,
    nextRecoveryAuthority: nextRecovery.address,
    recoveryEpoch: BigInt(epoch),
    authorityNonce: BigInt(authorityNonce),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    mnemonicClient: true,
  });
  const signature = await signSecp256k1(recovery.privateKey, recoveryDigest(request));
  const recoveryTx = await broadcastRecovery({ rpc: rpcUrl, payerKey, account, request, signature });
  const recoveryReceipt = await publicClient.waitForTransactionReceipt({ hash: recoveryTx });
  if (recoveryReceipt.status !== "success") throw new Error("Recovery was not included.");
  await waitForHot(rpcUrl, account, recovered.signer);
  console.log(`${chain.name}: recovery ${recoveryTx}`);

  const generation = await publicClient.readContract({ address: account, abi: accountAbi, functionName: "generation" });
  const previousNext = await keys.create("secp256k1");
  const previousOp = buildUserOp({
    sender: account,
    nonce: BigInt(generation),
    callData: executeAndRotateCalldata({
      calls: [],
      nextSigner: previousNext.signer,
      nextKeyType: KEY_SECP256K1,
    }),
    keyType: KEY_SECP256K1,
    gas: fallbackGas(false),
  });
  await expectRejected(bundlerUrl, {
    ...previousOp,
    signature: await keys.sign(afterSecond.id, userOpHash(previousOp, BigInt(chainId))),
  });
  await waitForHot(rpcUrl, account, recovered.signer);
  console.log(`${chain.name}: previous key rejected`);

  return {
    chainId,
    account,
    firstSend,
    secondSend,
    retiredKeyRejected: true,
    oldActivationRejected: true,
    recovery: { txHash: recoveryTx },
    previousKeyRejected: true,
  };
}

async function main(): Promise<void> {
  const requested = envValue("KNOAD_REHEARSE_CHAIN");
  const chainIds = requested ? [Number(requested)] : [84532, ...(envValue("EXPO_PUBLIC_KNOAD_BUNDLER_11155111") ? [11155111] : [])];
  for (const chainId of chainIds) assertRehearsalChain(chainId);
  for (const chainId of chainIds) {
    const report = await rehearse(chainId, Boolean(requested));
    writeFileSync(join(root, "test-vectors", `rehearse-${chainId}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote test-vectors/rehearse-${chainId}.json`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(scrub(error));
    process.exit(1);
  });
}
