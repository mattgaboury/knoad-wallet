import {
  KEY_P256,
  KEY_SECP256K1,
  WriteAheadLog,
  accountInitCode,
  activationDigest,
  buildFirstUseOp,
  buildUserOp,
  defaultTestGas,
  classifySecureNetwork,
  deployments,
  deriveInitialHot,
  deriveRecovery,
  executeAndRotateCalldata,
  factoryAbi,
  memoryKv,
  predictDeployedAccount,
  prepareActivations,
  prepareRotation,
  reconcileGeneration,
  serializeUserOperation,
  signSecp256k1,
  softwareHotKeystore,
  userOpHash,
  type Address,
  type Call,
  type Hex,
  type KeyType,
  type OperationGas,
  type PackedUserOperation,
} from "@knoad/wallet-core";
import { execFileSync } from "node:child_process";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { decodeFunctionResult, encodeFunctionData as encode, getAddress } from "viem";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

const accountReads = [
  { type: "function", name: "generation", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "hotSigner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const sinkAbi = [
  { type: "function", name: "take", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "fail", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "received", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const depositAbi = [
  {
    type: "function",
    name: "depositTo",
    stateMutability: "payable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
] as const;

export type LiveReport = {
  chainId: number;
  entryPoint: Address;
  factory: Address;
  bundler: "alto-safe-mode";
  p256: "untested" | "used";
  p256Note: string;
  phoneScreens: string;
  scenarios: { name: string; detail: string }[];
};

export async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? `${method} failed`);
  return body.result;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runLiveScenarios(args: {
  rpcUrl: string;
  bundlerUrl: string;
  chainId: number;
  sink: Address;
  funder: Address;
  laterKeyType: KeyType;
  p256Note: string;
}): Promise<LiveReport> {
  const recovery = deriveRecovery(MNEMONIC, 0, 0);
  const hot = deriveInitialHot(MNEMONIC, 0, args.chainId);
  const account = predictDeployedAccount({ recovery: recovery.address });
  const activation = await signSecp256k1(
    recovery.privateKey,
    activationDigest({
      account,
      chainId: BigInt(args.chainId),
      initialSigner: hot.address,
      keyType: KEY_SECP256K1,
    }),
  );
  const initCode = accountInitCode({
    factory: deployments.factory,
    recovery: recovery.address,
    initialSigner: hot.address,
    keyType: KEY_SECP256K1,
    signature: activation,
  });
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [account, "0x8AC7230489E80000"]);
  const deposit = encode({ abi: depositAbi, functionName: "depositTo", args: [account] });
  const funded = (await jsonRpc(args.rpcUrl, "eth_sendTransaction", [
    { from: args.funder, to: deployments.entryPoint, data: deposit, value: "0xDE0B6B3A7640000" },
  ])) as Hex;
  await waitTx(args.rpcUrl, funded);

  const block = (await jsonRpc(args.rpcUrl, "eth_getBlockByNumber", ["latest", false])) as { baseFeePerGas?: string };
  const base = BigInt(block.baseFeePerGas ?? "0x0");
  const priority = base > 1_000_000_000n ? base : 1_000_000_000n;
  const gas: OperationGas = {
    ...defaultTestGas(KEY_SECP256K1),
    maxPriorityFeePerGas: priority,
    maxFeePerGas: priority * 3n,
    preVerificationGas: 500_000n,
  };

  const phone = new Phone({
    rpcUrl: args.rpcUrl,
    bundlerUrl: args.bundlerUrl,
    chainId: args.chainId,
    account,
    initCode,
    gas,
    laterKeyType: args.laterKeyType,
    initial: { signer: hot.address, privateKey: hot.privateKey },
  });
  const report: LiveReport = {
    chainId: args.chainId,
    entryPoint: deployments.entryPoint,
    factory: deployments.factory,
    bundler: "alto-safe-mode",
    p256: args.laterKeyType === KEY_P256 ? "used" : "untested",
    p256Note: args.p256Note,
    phoneScreens: "The phone screens were not clicked through.",
    scenarios: [],
  };
  const pay = (value = 1n): Call[] => [
    { target: args.sink, value, data: encode({ abi: sinkAbi, functionName: "take" }) },
  ];
  const fail = (): Call[] => [{ target: args.sink, value: 1n, data: encode({ abi: sinkAbi, functionName: "fail" }) }];

  const beforeFirst = await received(args.rpcUrl, args.sink);
  await phone.land(await phone.operation(pay()));
  check((await codeSize(args.rpcUrl, account)) > 2, "First use did not deploy the account.");
  check((await phone.signer()) === phone.current.signer, "First use did not validate under the activated key.");
  check((await received(args.rpcUrl, args.sink)) === beforeFirst + 1n, "First use did not pay.");
  report.scenarios.push({ name: "first-use", detail: "Activation in initCode deployed the account and rotated." });
  await spend(phone, args, pay, report, "after first use");

  const beforeSend = await received(args.rpcUrl, args.sink);
  const beforeGen = phone.generation;
  await phone.land(await phone.operation(pay(2n)));
  check(phone.generation === beforeGen + 1n, "A normal send did not rotate.");
  check((await received(args.rpcUrl, args.sink)) === beforeSend + 2n, "A normal send did not pay.");
  report.scenarios.push({ name: "send-and-rotate", detail: "One included send rotated once and paid." });
  await spend(phone, args, pay, report, "after a normal send");

  const beforeSpeed = await received(args.rpcUrl, args.sink);
  const pending = await phone.operation(pay(3n));
  await phone.submit(pending);
  const replacement = await phone.operation(pay(3n), bump(phone.gasForCurrent()));
  await phone.submit(replacement);
  await phone.landSubmitted(replacement);
  check((await received(args.rpcUrl, args.sink)) === beforeSpeed + 3n, "The speed-up did not pay once.");
  report.scenarios.push({ name: "speed-up", detail: "The replacement at the same nonce landed, and the key rotated once." });
  await spend(phone, args, pay, report, "after a speed-up");

  const beforeCancel = await received(args.rpcUrl, args.sink);
  const toCancel = await phone.operation(pay(4n));
  await phone.submit(toCancel);
  const cancel = await phone.operation([], bump(phone.gasForCurrent()));
  await phone.submit(cancel);
  const cancelled = await phone.landSubmitted(cancel);
  check(cancelled.success, "The cancel was included as a failure.");
  check((await received(args.rpcUrl, args.sink)) === beforeCancel, "The cancel still paid.");
  report.scenarios.push({ name: "cancel", detail: "The empty replacement landed. The payment did not." });
  await spend(phone, args, pay, report, "after a cancel");

  const beforeRace = await received(args.rpcUrl, args.sink);
  const original = await phone.operation(pay(5n));
  await phone.submit(original);
  await phone.bundle();
  const landed = await phone.receipt(phone.hashOf(original));
  check(landed.success, "The original send failed.");
  check((await received(args.rpcUrl, args.sink)) === beforeRace + 5n, "The original send did not pay.");
  const chainGeneration = await phone.chainGeneration();
  check(reconcileGeneration(phone.generation, chainGeneration) === "catch-up", "The phone was not behind the chain.");
  let refused = false;
  try {
    await phone.submit(await phone.operation(pay(5n), bump(phone.gasForCurrent())));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    refused = /nonce|AA25|already known|replacement/i.test(message);
    if (!refused) throw error;
  }
  check(refused, "The late replacement was accepted.");
  await phone.catchUp();
  report.scenarios.push({
    name: "original-lands-first",
    detail: "The replacement was refused. The phone caught up to the included send.",
  });
  await spend(phone, args, pay, report, "after a refused replacement");

  const beforeRevert = await received(args.rpcUrl, args.sink);
  const reverting = await phone.land(await phone.operation(fail()));
  check(!reverting.success, "A reverting send was reported as success.");
  check((await received(args.rpcUrl, args.sink)) === beforeRevert, "A reverting send moved ETH.");
  check((await phone.signer()) === phone.current.signer, "A reverting send did not rotate.");
  report.scenarios.push({ name: "reverting-send", detail: "The key rotated and the receipt reported failure." });
  await spend(phone, args, pay, report, "after a reverting send");

  const beforeBundle = await received(args.rpcUrl, args.sink);
  const keyA = await phone.prepareNext();
  const keyB = await phone.keystore.create(args.laterKeyType === KEY_P256 ? "p256" : "secp256k1");
  const first = await phone.operationSigned(pay(6n), phone.generation, phone.current, {
    signer: keyA.nextSigner,
    keyType: keyA.nextKeyType,
  });
  const secondSigner: Held = { id: keyA.nextKeyId, signer: keyA.nextSigner, keyType: keyA.nextKeyType };
  const second = await phone.operationSigned(
    pay(7n),
    phone.generation + 1n,
    secondSigner,
    { signer: keyB.signer, keyType: keyB.keyType },
    phone.gasFor(secondSigner.keyType),
  );
  await phone.submit(first);
  await phone.submit(second);
  await phone.bundle();
  const firstReceipt = await phone.receipt(phone.hashOf(first));
  const secondReceipt = await phone.receipt(phone.hashOf(second));
  check(firstReceipt.success && secondReceipt.success, "A bundled operation failed.");
  check(firstReceipt.tx === secondReceipt.tx, "The two operations were not in one bundle.");
  check((await received(args.rpcUrl, args.sink)) === beforeBundle + 13n, "The bundle did not pay both calls.");
  await phone.adoptKey({ id: keyB.id, signer: keyB.signer, keyType: keyB.keyType }, 2n);
  report.scenarios.push({ name: "two-ops-one-bundle", detail: "Both operations executed in one bundle, each under its own validation." });
  await spend(phone, args, pay, report, "after two operations in one bundle");

  const beforeRepeat = await received(args.rpcUrl, args.sink);
  const repeatB = await phone.prepareNext();
  const repeatC = await phone.keystore.create(args.laterKeyType === KEY_P256 ? "p256" : "secp256k1");
  const repeatHeldB: Held = { id: repeatB.nextKeyId, signer: repeatB.nextSigner, keyType: repeatB.nextKeyType };
  const repeatHeldC: Held = { id: repeatC.id, signer: repeatC.signer, keyType: repeatC.keyType };
  const repeatFirst = await phone.operationSigned(pay(9n), phone.generation, phone.current, {
    signer: repeatHeldB.signer,
    keyType: repeatHeldB.keyType,
  });
  const repeatSecond = await phone.operationSigned(
    pay(10n),
    phone.generation + 1n,
    repeatHeldB,
    { signer: repeatHeldC.signer, keyType: repeatHeldC.keyType },
    phone.gasFor(repeatHeldB.keyType),
  );
  const repeatThird = await phone.operationSigned(
    pay(11n),
    phone.generation + 2n,
    repeatHeldC,
    { signer: repeatHeldB.signer, keyType: repeatHeldB.keyType },
    phone.gasFor(repeatHeldC.keyType),
  );
  await phone.submit(repeatFirst);
  await phone.submit(repeatSecond);
  await phone.submit(repeatThird);
  await phone.bundle();
  const repeatReceipts = await Promise.all([
    phone.receipt(phone.hashOf(repeatFirst)),
    phone.receipt(phone.hashOf(repeatSecond)),
    phone.receipt(phone.hashOf(repeatThird)),
  ]);
  check(repeatReceipts.every((item) => item.success), "A repeated-key operation failed.");
  check(
    repeatReceipts[0].tx === repeatReceipts[1].tx && repeatReceipts[1].tx === repeatReceipts[2].tx,
    "The repeated-key operations were not in one bundle.",
  );
  check((await received(args.rpcUrl, args.sink)) === beforeRepeat + 30n, "The repeated-key bundle did not pay every call.");
  check((await phone.signer()) === getAddress(repeatHeldB.signer), "The repeated next key did not end as the signer.");
  await phone.adoptKey(repeatHeldB, 3n);
  report.scenarios.push({
    name: "repeated-next-key-one-bundle",
    detail: "A to B, B to C, and C to B all executed in one bundle.",
  });
  await spend(phone, args, pay, report, "after a repeated next key");

  await runFirstUseDemonstrations({
    rpcUrl: args.rpcUrl,
    bundlerUrl: args.bundlerUrl,
    chainId: args.chainId,
    sink: args.sink,
    funder: args.funder,
    gas,
    report,
  });

  return report;
}

async function spend(
  phone: Phone,
  args: { rpcUrl: string; sink: Address },
  pay: (value?: bigint) => Call[],
  report: LiveReport,
  label: string,
): Promise<void> {
  const before = await received(args.rpcUrl, args.sink);
  const receipt = await phone.land(await phone.operation(pay(8n)));
  check(receipt.success, `Spending ${label} failed.`);
  check((await received(args.rpcUrl, args.sink)) === before + 8n, `Spending ${label} did not pay.`);
  report.scenarios.push({ name: `spend ${label}`, detail: "A later send paid with the key that was just installed." });
}

async function received(rpcUrl: string, sink: Address): Promise<bigint> {
  const data = encode({ abi: sinkAbi, functionName: "received" });
  const result = (await jsonRpc(rpcUrl, "eth_call", [{ to: sink, data }, "latest"])) as Hex;
  return decodeFunctionResult({ abi: sinkAbi, functionName: "received", data: result });
}

async function codeSize(rpcUrl: string, account: Address): Promise<number> {
  const code = (await jsonRpc(rpcUrl, "eth_getCode", [account, "latest"])) as string;
  return code.length;
}

async function waitTx(rpcUrl: string, hash: Hex): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const receipt = await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (receipt) return;
    await delay(250);
  }
  throw new Error("Transaction was not mined.");
}

type Held = { id: string | null; signer: Address; keyType: KeyType; privateKey?: Hex };
type Next = { signer: Address; keyType: KeyType };

class Phone {
  readonly keystore;
  readonly wal;
  generation = 0n;
  deployed = false;
  current: Held;

  constructor(
    private readonly env: {
      rpcUrl: string;
      bundlerUrl: string;
      chainId: number;
      account: Address;
      initCode: Hex;
      gas: OperationGas;
      laterKeyType: KeyType;
      initial: { signer: Address; privateKey: Hex };
    },
  ) {
    const kv = memoryKv();
    this.keystore = softwareHotKeystore(kv);
    this.wal = new WriteAheadLog(kv);
    this.current = { id: null, signer: env.initial.signer, keyType: KEY_SECP256K1, privateKey: env.initial.privateKey };
  }

  gasFor(keyType: KeyType): OperationGas {
    return {
      ...this.env.gas,
      verificationGasLimit: keyType === KEY_P256 ? 8_000_000n : 1_500_000n,
    };
  }

  gasForCurrent(): OperationGas {
    return this.gasFor(this.current.keyType);
  }

  hashOf(op: PackedUserOperation): string {
    return userOpHash(op, BigInt(this.env.chainId));
  }

  async prepareNext() {
    try {
      return await this.wal.requirePrepared(this.env.account, this.env.chainId, this.generation);
    } catch (error) {
      const missing = error instanceof Error && error.message.includes("Write-ahead missing");
      if (!missing) throw error;
      await prepareRotation({
        account: this.env.account,
        chainId: this.env.chainId,
        generation: this.generation,
        keystore: this.keystore,
        wal: this.wal,
        keyType: this.env.laterKeyType,
      });
      return this.wal.requirePrepared(this.env.account, this.env.chainId, this.generation);
    }
  }

  async operation(calls: Call[], gas = this.gasForCurrent()): Promise<PackedUserOperation> {
    const prepared = await this.prepareNext();
    return this.operationSigned(calls, this.generation, this.current, {
      signer: prepared.nextSigner,
      keyType: prepared.nextKeyType,
    }, gas);
  }

  async operationSigned(
    calls: Call[],
    nonce: bigint,
    signer: Held,
    next: Next,
    gas?: OperationGas,
  ): Promise<PackedUserOperation> {
    const priced = gas ?? this.gasFor(signer.keyType);
    const callData = executeAndRotateCalldata({ calls, nextSigner: next.signer, nextKeyType: next.keyType });
    const draft = buildUserOp({
      sender: this.env.account,
      nonce,
      callData,
      initCode: this.deployed ? "0x" : this.env.initCode,
      keyType: signer.keyType,
      gas: priced,
    });
    const signature = signer.id
      ? await this.keystore.sign(signer.id, userOpHash(draft, BigInt(this.env.chainId)))
      : await signSecp256k1(signer.privateKey as Hex, userOpHash(draft, BigInt(this.env.chainId)));
    return { ...draft, signature };
  }

  async submit(op: PackedUserOperation): Promise<string> {
    const hash = await jsonRpc(this.env.bundlerUrl, "eth_sendUserOperation", [
      serializeUserOperation(op),
      deployments.entryPoint,
    ]);
    check(typeof hash === "string", "The bundler did not return an operation hash.");
    return hash;
  }

  async bundle(): Promise<void> {
    const result = await jsonRpc(this.env.bundlerUrl, "debug_bundler_sendBundleNow", []);
    check(result === "ok", "The bundler did not send the bundle.");
  }

  async receipt(hash: string): Promise<{ success: boolean; tx: string }> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = (await jsonRpc(this.env.bundlerUrl, "eth_getUserOperationReceipt", [hash])) as {
        success?: boolean;
        receipt?: { transactionHash?: string };
      } | null;
      if (result?.receipt?.transactionHash) {
        check(typeof result.success === "boolean", "The receipt did not say whether the operation succeeded.");
        return { success: result.success, tx: result.receipt.transactionHash };
      }
      await delay(400);
    }
    throw new Error("The operation was not included.");
  }

  async land(op: PackedUserOperation): Promise<{ success: boolean; tx: string }> {
    await this.submit(op);
    return this.landSubmitted(op);
  }

  async landSubmitted(op: PackedUserOperation): Promise<{ success: boolean; tx: string }> {
    await this.bundle();
    const included = await this.receipt(this.hashOf(op));
    await this.catchUp();
    return included;
  }

  async catchUp(): Promise<void> {
    const chain = await this.chainGeneration();
    const relation = reconcileGeneration(this.generation, chain);
    if (relation === "current") return;
    check(relation === "catch-up" && chain === this.generation + 1n, "The chain moved by more than one key.");
    const prepared = await this.wal.requirePrepared(this.env.account, this.env.chainId, this.generation);
    this.current = { id: prepared.nextKeyId, signer: prepared.nextSigner, keyType: prepared.nextKeyType };
    this.generation = chain;
    this.deployed = true;
    await this.wal.commit(this.env.account, this.env.chainId);
  }

  async adoptKey(next: Held, steps: bigint): Promise<void> {
    this.current = next;
    this.generation += steps;
    this.deployed = true;
    await this.wal.commit(this.env.account, this.env.chainId);
  }

  async chainGeneration(): Promise<bigint> {
    const data = encode({ abi: accountReads, functionName: "generation" });
    const result = (await jsonRpc(this.env.rpcUrl, "eth_call", [{ to: this.env.account, data }, "latest"])) as Hex;
    return decodeFunctionResult({ abi: accountReads, functionName: "generation", data: result });
  }

  async signer(): Promise<Address> {
    const data = encode({ abi: accountReads, functionName: "hotSigner" });
    const result = (await jsonRpc(this.env.rpcUrl, "eth_call", [{ to: this.env.account, data }, "latest"])) as Hex;
    return getAddress(decodeFunctionResult({ abi: accountReads, functionName: "hotSigner", data: result }));
  }

}

function bump(gas: OperationGas): OperationGas {
  return {
    ...gas,
    maxPriorityFeePerGas: (gas.maxPriorityFeePerGas * 12n) / 10n + 1n,
    maxFeePerGas: (gas.maxFeePerGas * 12n) / 10n + 1n,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TWO_YEARS = 2 * 365 * 24 * 60 * 60;

function testPhrase(seed: number): string {
  const entropy = new Uint8Array(32);
  entropy[31] = seed;
  return entropyToMnemonic(entropy, wordlist);
}

function deployGas(gas: OperationGas): OperationGas {
  return {
    ...gas,
    verificationGasLimit: 3_000_000n,
    callGasLimit: 1_000_000n,
    preVerificationGas: 500_000n,
  };
}

async function runFirstUseDemonstrations(args: {
  rpcUrl: string;
  bundlerUrl: string;
  chainId: number;
  sink: Address;
  funder: Address;
  gas: OperationGas;
  report: LiveReport;
}): Promise<void> {
  const env = { rpcUrl: args.rpcUrl, bundlerUrl: args.bundlerUrl, chainId: args.chainId };
  const gas = deployGas(args.gas);

  const old = await openFresh(testPhrase(1), args.chainId);
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [old.account, "0x8AC7230489E80000"]);
  const beforeTime = await blockTime(args.rpcUrl);
  await jsonRpc(args.rpcUrl, "evm_increaseTime", [TWO_YEARS]);
  await jsonRpc(args.rpcUrl, "evm_mine", []);
  check((await blockTime(args.rpcUrl)) >= beforeTime + BigInt(TWO_YEARS), "Chain time did not move.");
  const oldNext = await landFirstUse(env, old, old.activation, gas);
  check((await codeSize(args.rpcUrl, old.account)) > 2, "An old activation did not deploy.");
  check((await hotSignerOf(args.rpcUrl, old.account)) === getAddress(oldNext.signer), "An old activation did not install its next key.");
  await spendFrom(env, old.account, 1n, oldNext, args.sink, gas, 1n);
  args.report.scenarios.push({
    name: "old-device-first-use",
    detail: "A creation-time activation still deployed after about two years, and a later send paid.",
  });

  const restoredPhrase = testPhrase(2);
  const restoredRecovery = deriveRecovery(restoredPhrase, 0, 0);
  const restoredAccount = predictDeployedAccount({ recovery: restoredRecovery.address });
  const created = await prepareActivations(restoredPhrase, restoredAccount, [args.chainId]);
  const restored = await prepareActivations(restoredPhrase, restoredAccount, [args.chainId]);
  check(restored[0].activationSignature === created[0].activationSignature, "Restoring did not rebuild the same activation.");
  check(restored[0].initialKey === created[0].initialKey, "Restoring did not rebuild the same first key.");
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [restoredAccount, "0x8AC7230489E80000"]);
  const restoredOpened = {
    account: restoredAccount,
    recovery: restoredRecovery.address,
    activation: restored[0],
  };
  const restoredNext = await landFirstUse(env, restoredOpened, restoredOpened.activation, gas);
  check((await hotSignerOf(args.rpcUrl, restoredAccount)) === getAddress(restoredNext.signer), "A restored phone did not activate.");
  await spendFrom(env, restoredAccount, 1n, restoredNext, args.sink, gas, 1n);
  args.report.scenarios.push({
    name: "restored-device-first-use",
    detail: "Entering the words again rebuilt the same activation, and that activation deployed.",
  });

  const addedPhrase = testPhrase(3);
  const addedRecovery = deriveRecovery(addedPhrase, 0, 0);
  const addedAccount = predictDeployedAccount({ recovery: addedRecovery.address });
  const withoutThisChain = await prepareActivations(addedPhrase, addedAccount, [1, 8453, 11155111, 84532]);
  const needsWords = !withoutThisChain.some((item) => item.chainId === args.chainId);
  check(needsWords, "The new network was already signed.");
  const [added] = await prepareActivations(addedPhrase, addedAccount, [args.chainId]);
  check(Boolean(added.activationSignature), "Entering the words did not sign the new network.");
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [addedAccount, "0x8AC7230489E80000"]);
  const addedNext = await landFirstUse(
    env,
    { account: addedAccount, recovery: addedRecovery.address },
    added,
    gas,
  );
  check((await hotSignerOf(args.rpcUrl, addedAccount)) === getAddress(addedNext.signer), "The new network did not activate.");
  await spendFrom(env, addedAccount, 1n, addedNext, args.sink, gas, 1n);
  args.report.scenarios.push({
    name: "new-network-first-use",
    detail: "A chain left out of creation needed the words, and those words signed its activation.",
  });

  const stolen = await openFresh(testPhrase(4), args.chainId);
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [stolen.account, "0x8AC7230489E80000"]);
  const ownerKeys = softwareHotKeystore(memoryKv());
  const ownerInitial = await ownerKeys.create("secp256k1");
  const ownerNext = await ownerKeys.create("secp256k1");
  const ownerSignature = await signSecp256k1(
    stolen.recoveryKey,
    activationDigest({
      account: stolen.account,
      chainId: BigInt(args.chainId),
      initialSigner: ownerInitial.signer,
      keyType: KEY_SECP256K1,
    }),
  );
  const ownerOp = await buildFirstUseOp({
    account: stolen.account,
    chainId: BigInt(args.chainId),
    recovery: stolen.recovery,
    initialSigner: ownerInitial.signer,
    initialKeyType: KEY_SECP256K1,
    activationSignature: ownerSignature,
    nextSigner: ownerNext.signer,
    nextKeyType: KEY_SECP256K1,
    signInitial: (digest) => ownerKeys.sign(ownerInitial.id, digest),
    gas,
  });
  const ownerReceipt = await includeOp(env, ownerOp);
  check(ownerReceipt.success, "Recovery first use failed.");
  check((await hotSignerOf(args.rpcUrl, stolen.account)) === getAddress(ownerNext.signer), "Recovery did not install its key.");
  const held = await nativeBalance(args.rpcUrl, stolen.account);
  const thiefNext = deriveInitialHot(stolen.phrase, 0, args.chainId + 1);
  const thiefOp = await buildFirstUseOp({
    account: stolen.account,
    chainId: BigInt(args.chainId),
    recovery: stolen.recovery,
    initialSigner: stolen.activation.initialSigner,
    initialKeyType: KEY_SECP256K1,
    activationSignature: stolen.activation.activationSignature,
    nextSigner: thiefNext.address,
    nextKeyType: KEY_SECP256K1,
    calls: [{ target: args.sink, value: 1n, data: encode({ abi: sinkAbi, functionName: "take" }) }],
    signInitial: (digest) => signSecp256k1(stolen.activation.initialKey, digest),
    gas,
  });
  const thiefLanded = await tryInclude(env, thiefOp);
  check(!thiefLanded, "The old phone's activation was still accepted.");
  check((await nativeBalance(args.rpcUrl, stolen.account)) === held, "The old phone moved funds after recovery.");
  check((await hotSignerOf(args.rpcUrl, stolen.account)) === getAddress(ownerNext.signer), "The old phone replaced the recovery key.");
  await spendFrom(env, stolen.account, 1n, { keys: ownerKeys, id: ownerNext.id, signer: ownerNext.signer }, args.sink, gas, 1n);
  args.report.scenarios.push({
    name: "stolen-phone-loses-race",
    detail: "Recovery opened the funded chain with a new key. The old activation was refused and the funds stayed.",
  });

  await demonstrateOutsideClose(args, env, gas);
}

async function openFresh(phrase: string, chainId: number): Promise<{
  phrase: string;
  account: Address;
  recovery: Address;
  recoveryKey: Hex;
  activation: Awaited<ReturnType<typeof prepareActivations>>[number];
}> {
  const derived = deriveRecovery(phrase, 0, 0);
  const account = predictDeployedAccount({ recovery: derived.address });
  const [activation] = await prepareActivations(phrase, account, [chainId]);
  return { phrase, account, recovery: derived.address, recoveryKey: derived.privateKey, activation };
}

type HeldKey = { keys: ReturnType<typeof softwareHotKeystore>; id: string; signer: Address };

async function landFirstUse(
  env: { rpcUrl: string; bundlerUrl: string; chainId: number },
  opened: { account: Address; recovery: Address },
  activation: Awaited<ReturnType<typeof prepareActivations>>[number],
  gas: OperationGas,
): Promise<HeldKey> {
  const keys = softwareHotKeystore(memoryKv());
  const next = await keys.create("secp256k1");
  const op = await buildFirstUseOp({
    account: opened.account,
    chainId: BigInt(env.chainId),
    recovery: opened.recovery,
    initialSigner: activation.initialSigner,
    initialKeyType: KEY_SECP256K1,
    activationSignature: activation.activationSignature,
    nextSigner: next.signer,
    nextKeyType: KEY_SECP256K1,
    signInitial: (digest) => signSecp256k1(activation.initialKey, digest),
    gas,
  });
  const receipt = await includeOp(env, op);
  check(receipt.success, "First use was included as a failure.");
  return { keys, id: next.id, signer: next.signer };
}

async function spendFrom(
  env: { rpcUrl: string; bundlerUrl: string; chainId: number },
  account: Address,
  nonce: bigint,
  signer: HeldKey,
  sink: Address,
  gas: OperationGas,
  value: bigint,
): Promise<void> {
  const next = await signer.keys.create("secp256k1");
  const before = await received(env.rpcUrl, sink);
  const callData = executeAndRotateCalldata({
    calls: [{ target: sink, value, data: encode({ abi: sinkAbi, functionName: "take" }) }],
    nextSigner: next.signer,
    nextKeyType: KEY_SECP256K1,
  });
  const draft = buildUserOp({ sender: account, nonce, callData, keyType: KEY_SECP256K1, gas });
  const op = {
    ...draft,
    signature: await signer.keys.sign(signer.id, userOpHash(draft, BigInt(env.chainId))),
  };
  const receipt = await includeOp(env, op);
  check(receipt.success, "The later spend failed.");
  check((await received(env.rpcUrl, sink)) === before + value, "The later spend did not pay.");
}

async function includeOp(
  env: { rpcUrl: string; bundlerUrl: string; chainId: number },
  op: PackedUserOperation,
): Promise<{ success: boolean; tx: string }> {
  await jsonRpc(env.bundlerUrl, "eth_sendUserOperation", [serializeUserOperation(op), deployments.entryPoint]);
  const bundled = await jsonRpc(env.bundlerUrl, "debug_bundler_sendBundleNow", []);
  check(bundled === "ok", "The bundler did not send the bundle.");
  const hash = userOpHash(op, BigInt(env.chainId));
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = (await jsonRpc(env.bundlerUrl, "eth_getUserOperationReceipt", [hash])) as {
      success?: boolean;
      receipt?: { transactionHash?: string };
    } | null;
    if (result?.receipt?.transactionHash) {
      return { success: result.success === true, tx: result.receipt.transactionHash };
    }
    await delay(400);
  }
  throw new Error("The operation was not included.");
}

async function tryInclude(
  env: { rpcUrl: string; bundlerUrl: string; chainId: number },
  op: PackedUserOperation,
): Promise<boolean> {
  try {
    const receipt = await includeOp(env, op);
    return receipt.success;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/AA10|AA24|AA25|signature|already|Invalid|rejected|revert|not included|did not send the bundle/i.test(message)) {
      return false;
    }
    throw error;
  }
}

async function hotSignerOf(rpcUrl: string, account: Address): Promise<Address> {
  const data = encode({ abi: accountReads, functionName: "hotSigner" });
  const result = (await jsonRpc(rpcUrl, "eth_call", [{ to: account, data }, "latest"])) as Hex;
  return getAddress(decodeFunctionResult({ abi: accountReads, functionName: "hotSigner", data: result }));
}

async function nativeBalance(rpcUrl: string, account: Address): Promise<bigint> {
  return BigInt((await jsonRpc(rpcUrl, "eth_getBalance", [account, "latest"])) as string);
}

async function blockTime(rpcUrl: string): Promise<bigint> {
  const block = (await jsonRpc(rpcUrl, "eth_getBlockByNumber", ["latest", false])) as { timestamp?: string };
  return BigInt(block.timestamp ?? "0x0");
}

const giftAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function demonstrateOutsideClose(
  args: { rpcUrl: string; chainId: number; funder: Address; report: LiveReport },
  env: { rpcUrl: string; bundlerUrl: string; chainId: number },
  gas: OperationGas,
): Promise<void> {
  const empty = await openFresh(testPhrase(5), args.chainId);
  const tokens = await openFresh(testPhrase(6), args.chainId);
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [empty.account, "0x0"]);
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [tokens.account, "0x0"]);
  const gift = await deployGift(args.rpcUrl, args.funder);
  const minted = await sendTx(args.rpcUrl, {
    from: args.funder,
    to: gift,
    data: encode({ abi: giftAbi, functionName: "mint", args: [tokens.account, 1n] }),
  });
  check(minted.status === "0x1", "The token mint failed.");
  const emptyNative = await nativeBalance(args.rpcUrl, empty.account);
  const tokenNative = await nativeBalance(args.rpcUrl, tokens.account);
  const heldTokens = await giftBalance(args.rpcUrl, gift, tokens.account);
  const emptyClass = classifySecureNetwork({
    checked: true,
    deployed: false,
    secured: false,
    nativeBalance: emptyNative,
    holdsTokens: false,
    tokensKnown: true,
  });
  const tokenClass = classifySecureNetwork({
    checked: true,
    deployed: false,
    secured: false,
    nativeBalance: tokenNative,
    holdsTokens: heldTokens > 0n,
    tokensKnown: true,
  });
  check(emptyClass.status === "needs-outside-payer" && emptyClass.reason === "empty", "The empty chain was not left for an outside payer.");
  check(tokenClass.status === "needs-outside-payer" && tokenClass.reason === "tokens", "The token chain was not left for an outside payer.");

  const keys = softwareHotKeystore(memoryKv());
  const installed = await keys.create("secp256k1");
  const paid = await sendTx(args.rpcUrl, {
    from: args.funder,
    to: deployments.factory,
    data: encode({
      abi: factoryAbi,
      functionName: "createAccount",
      args: [
        tokens.recovery,
        0n,
        {
          initialSigner: installed.signer,
          keyType: KEY_SECP256K1,
          signature: await signSecp256k1(
            tokens.recoveryKey,
            activationDigest({
              account: tokens.account,
              chainId: BigInt(args.chainId),
              initialSigner: installed.signer,
              keyType: KEY_SECP256K1,
            }),
          ),
        },
      ],
    }),
  });
  check(paid.status === "0x1", "The outside payment did not close the token chain.");
  check((await hotSignerOf(args.rpcUrl, tokens.account)) === getAddress(installed.signer), "The outside payment did not install the new key.");
  const replay = await sendTx(args.rpcUrl, {
    from: args.funder,
    to: deployments.factory,
    data: encode({
      abi: factoryAbi,
      functionName: "createAccount",
      args: [
        tokens.recovery,
        0n,
        {
          initialSigner: tokens.activation.initialSigner,
          keyType: KEY_SECP256K1,
          signature: tokens.activation.activationSignature,
        },
      ],
    }),
  });
  check(replay.status === "0x1", "The old activation was not returned as the existing account.");
  check((await hotSignerOf(args.rpcUrl, tokens.account)) === getAddress(installed.signer), "The old activation replaced the new key.");
  await jsonRpc(args.rpcUrl, "anvil_setBalance", [tokens.account, "0xDE0B6B3A7640000"]);
  const thiefNext = deriveInitialHot(tokens.phrase, 0, args.chainId + 1);
  const thiefOp = await buildFirstUseOp({
    account: tokens.account,
    chainId: BigInt(args.chainId),
    recovery: tokens.recovery,
    initialSigner: tokens.activation.initialSigner,
    initialKeyType: KEY_SECP256K1,
    activationSignature: tokens.activation.activationSignature,
    nextSigner: thiefNext.address,
    nextKeyType: KEY_SECP256K1,
    signInitial: (digest) => signSecp256k1(tokens.activation.initialKey, digest),
    gas,
  });
  check(!(await tryInclude(env, thiefOp)), "The old phone's activation was still accepted.");

  const stillOpen = await sendTx(args.rpcUrl, {
    from: args.funder,
    to: deployments.factory,
    data: encode({
      abi: factoryAbi,
      functionName: "createAccount",
      args: [
        empty.recovery,
        0n,
        {
          initialSigner: empty.activation.initialSigner,
          keyType: KEY_SECP256K1,
          signature: empty.activation.activationSignature,
        },
      ],
    }),
  });
  check(stillOpen.status === "0x1", "The unpaid chain refused the old activation.");
  check(
    (await hotSignerOf(args.rpcUrl, empty.account)) === getAddress(empty.activation.initialSigner),
    "The unpaid chain did not install the old activation.",
  );
  args.report.scenarios.push({
    name: "secure-all-outside-payer",
    detail: "An empty account and a token-only account both needed an outside payer. Paying closed the token account. The unpaid account still accepted the old activation.",
  });
}

async function deployGift(rpcUrl: string, from: Address): Promise<Address> {
  const bytecode = execFileSync("forge", ["inspect", "GiftToken", "bytecode"], { encoding: "utf8" }).trim() as Hex;
  const receipt = await sendTx(rpcUrl, { from, data: bytecode });
  check(receipt.status === "0x1" && receipt.contractAddress, "The token was not deployed.");
  return getAddress(receipt.contractAddress as Address);
}

async function giftBalance(rpcUrl: string, token: Address, account: Address): Promise<bigint> {
  const data = encode({ abi: giftAbi, functionName: "balanceOf", args: [account] });
  const result = (await jsonRpc(rpcUrl, "eth_call", [{ to: token, data }, "latest"])) as Hex;
  return decodeFunctionResult({ abi: giftAbi, functionName: "balanceOf", data: result });
}

async function sendTx(
  rpcUrl: string,
  tx: { from: Address; to?: Address; data: Hex },
): Promise<{ status?: string; contractAddress?: string | null }> {
  const hash = (await jsonRpc(rpcUrl, "eth_sendTransaction", [tx])) as Hex;
  await waitTx(rpcUrl, hash);
  return (await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [hash])) as { status?: string; contractAddress?: string | null };
}
