import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, getAddress, recoverAddress, slice, toHex, zeroAddress, type Address, type Hex } from "viem";
import {
  activationDigest,
  buildFirstUseOp,
  buildRecoveryRequest,
  deriveInitialHot,
  deriveRecovery,
  enclaveHotKeystore,
  chainsOneRecoveryBehind,
  chainsRecoveryBehind,
  chainsToRetire,
  classifyChainCutoff,
  classifySecureNetwork,
  cutoffTarget,
  recoveryInstallEpoch,
  executeAndRotateCalldata,
  initialHotIsLive,
  recoverySteps,
  initialHotPath,
  InflightQueue,
  KEY_P256,
  KEY_SECP256K1,
  memoryKv,
  personalSignDigest,
  prepareActivations,
  p256SignerAddress,
  predictAccount,
  prepareRotation,
  reconcileGeneration,
  recoveryDigest,
  recoveryPath,
  routeSessionRequest,
  assertSessionHasNoKeyMaterial,
  dappFacingState,
  describeDecision,
  deployments,
  encodeTypedDataSignature,
  erc7739TypedData,
  hotKeyTypeForChain,
  migrateVaultRecord,
  chainState,
  withChainState,
  resolveChain,
  createVaultKey,
  sealUtf8,
  sealUtf8WithKey,
  openUtf8,
  openUtf8Async,
  openUtf8WithKey,
  signP256,
  signSecp256k1,
  softwareHotKeystore,
  userOpHash,
  WriteAheadLog,
  predictDeployedAccount,
} from "./index";

const root = dirname(fileURLToPath(new URL("../../../package.json", import.meta.url)));
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const ACCOUNT = "0x00000000000000000000000000000000000000aa" as Address;

function loadJson(name: string) {
  return JSON.parse(readFileSync(join(root, "test-vectors", name), "utf8"));
}

test("derivation stays off the BIP-44 Ethereum path", () => {
  assert.equal(recoveryPath(0, 0), "m/7331'/60'/0'/0'/0'");
  assert.equal(initialHotPath(0, 1), "m/7331'/60'/0'/1'/1'");
  assert.equal(initialHotPath(0, 8453), "m/7331'/60'/0'/1'/8453'");
  const epoch0 = deriveRecovery(MNEMONIC, 0, 0);
  assert.equal(epoch0.address, "0xf5f2E05aD77bfbfF65A9D8A621ae8BaF0CB93e4C");
  const epoch1 = deriveRecovery(MNEMONIC, 0, 1);
  const hot = deriveInitialHot(MNEMONIC, 0, 1);
  const hotBase = deriveInitialHot(MNEMONIC, 0, 8453);
  assert.notEqual(hot.address, hotBase.address);
  const other = deriveRecovery(MNEMONIC, 1, 0);
  assert.notEqual(epoch0.address, epoch1.address);
  assert.notEqual(epoch0.address, hot.address);
  assert.notEqual(epoch0.address, other.address);
  assert.throws(() => deriveRecovery(MNEMONIC, 0, -1));
});

test("CREATE2 prediction matches the Forge fixture", () => {
  const fixture = loadJson("create2-fixture.json");
  const artifact = JSON.parse(
    readFileSync(join(root, "out/ERC1967Proxy.sol/ERC1967Proxy.json"), "utf8"),
  ) as { bytecode: { object: Hex } };
  const predicted = predictAccount({
    factory: fixture.factory,
    implementation: fixture.implementation,
    proxyCreationCode: artifact.bytecode.object,
    recovery: fixture.recovery,
    index: BigInt(fixture.index),
  });
  assert.equal(predicted.toLowerCase(), String(fixture.predicted).toLowerCase());
});

test("userOp hash matches EntryPoint v0.9", () => {
  const fixture = loadJson("userop-hash-fixture.json");
  const hash = userOpHash(
    {
      sender: fixture.sender,
      nonce: BigInt(fixture.nonce),
      initCode: "0x",
      callData: fixture.callData,
      accountGasLimits: toHex(BigInt(fixture.accountGasLimits), { size: 32 }),
      preVerificationGas: BigInt(fixture.preVerificationGas),
      gasFees: toHex(BigInt(fixture.gasFees), { size: 32 }),
      paymasterAndData: "0x",
    },
    BigInt(fixture.chainId),
    fixture.entryPoint,
  );
  assert.equal(BigInt(hash), BigInt(fixture.userOpHash));
});

test("recovery digest matches the account domain", () => {
  const fixture = loadJson("recovery-digest-fixture.json");
  const digest = recoveryDigest({
    account: fixture.account,
    chainId: BigInt(fixture.chainId),
    newHotSigner: fixture.newHotSigner,
    newHotKeyType: fixture.newHotKeyType,
    nextRecoveryAuthority: fixture.nextRecoveryAuthority,
    recoveryEpoch: BigInt(fixture.recoveryEpoch),
    authorityNonce: BigInt(fixture.authorityNonce),
    deadline: BigInt(fixture.deadline),
  });
  assert.equal(BigInt(digest), BigInt(fixture.digest));
});

test("activation digest matches the account domain", () => {
  const fixture = loadJson("activation-digest-fixture.json");
  const digest = activationDigest({
    account: fixture.account,
    chainId: BigInt(fixture.chainId),
    initialSigner: fixture.initialSigner,
    keyType: KEY_SECP256K1,
  });
  assert.equal(BigInt(digest), BigInt(fixture.digest));
  assert.equal(fixture.keyType, KEY_SECP256K1);
});

test("prepareActivations signs each chain's derived first key", async () => {
  const recovery = deriveRecovery(MNEMONIC, 0, 0);
  const account = predictDeployedAccount({ recovery: recovery.address });
  const prepared = await prepareActivations(MNEMONIC, account, [1, 8453]);
  assert.equal(prepared.length, 2);
  assert.notEqual(prepared[0].initialSigner, prepared[1].initialSigner);
  for (const item of prepared) {
    assert.equal(item.initialSigner, deriveInitialHot(MNEMONIC, 0, item.chainId).address);
    assert.equal(item.keyType, KEY_SECP256K1);
    const digest = activationDigest({
      account,
      chainId: BigInt(item.chainId),
      initialSigner: item.initialSigner,
      keyType: KEY_SECP256K1,
    });
    assert.equal(await recoverAddress({ hash: digest, signature: item.activationSignature }), getAddress(recovery.address));
  }
  const again = await prepareActivations(MNEMONIC, account, [1]);
  assert.equal(again[0].initialKey, prepared[0].initialKey);
  assert.equal(again[0].activationSignature, prepared[0].activationSignature);
});

test("buildFirstUseOp deploys with an empty call signed by the first key", async () => {
  const recovery = deriveRecovery(MNEMONIC, 0, 0);
  const account = predictDeployedAccount({ recovery: recovery.address });
  const [activation] = await prepareActivations(MNEMONIC, account, [1]);
  const next = deriveInitialHot(MNEMONIC, 0, 8453);
  const op = await buildFirstUseOp({
    account,
    chainId: 1n,
    recovery: recovery.address,
    initialSigner: activation.initialSigner,
    activationSignature: activation.activationSignature,
    nextSigner: next.address,
    nextKeyType: KEY_SECP256K1,
    signInitial: (digest) => signSecp256k1(activation.initialKey, digest),
  });
  assert.equal(op.nonce, 0n);
  assert.equal(getAddress(slice(op.initCode, 0, 20)), getAddress(deployments.factory));
  const decoded = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "executeAndRotate",
        inputs: [
          { name: "mode", type: "bytes32" },
          { name: "executionData", type: "bytes" },
          { name: "nextSigner", type: "address" },
          { name: "nextKeyType", type: "uint8" },
        ],
      },
    ],
    data: op.callData,
  });
  assert.equal(decoded.functionName, "executeAndRotate");
  const executionData = decoded.args?.[1];
  const nextSigner = decoded.args?.[2];
  assert.equal(executionData, "0x");
  assert.equal(typeof nextSigner, "string");
  assert.equal(getAddress(nextSigner as `0x${string}`), getAddress(next.address));
  const { signature, ...unsigned } = op;
  assert.equal(await recoverAddress({ hash: userOpHash(unsigned, 1n), signature }), getAddress(activation.initialSigner));
});

test("mnemonic recovery refuses to keep the same authority", () => {
  assert.throws(() =>
    buildRecoveryRequest({
      account: ACCOUNT,
      chainId: 8453n,
      newHotSigner: getAddress("0x0000000000000000000000000000000000000001"),
      newHotKeyType: KEY_P256,
      nextRecoveryAuthority: zeroAddress,
      recoveryEpoch: 0n,
      authorityNonce: 0n,
      deadline: 1n,
      mnemonicClient: true,
    }),
  );
});

test("personal-sign digests are bound to the account", () => {
  const a = personalSignDigest(ACCOUNT, 8453n, "link this wallet");
  const b = personalSignDigest(getAddress("0x00000000000000000000000000000000000000bb"), 8453n, "link this wallet");
  assert.notEqual(a, b);
  assert.equal(a.length, 66);
});

test("P-256 signature carries the public key and is low-s shaped", () => {
  const kv = memoryKv();
  return softwareHotKeystore(kv)
    .create()
    .then(async (created) => {
      const digest = `0x${"11".repeat(32)}` as Hex;
      const signature = signP256((await kv.get(created.id)) as Hex, digest);
      assert.equal(signature.length, 2 + 128 * 2);
      assert.equal(p256SignerAddress(`0x${signature.slice(2 + 128, 2 + 192)}`, `0x${signature.slice(2 + 192)}`), created.signer);
    });
});

test("write-ahead is persisted before a signature can be produced", async () => {
  const kv = memoryKv();
  const wal = new WriteAheadLog(kv);
  const keystore = softwareHotKeystore(kv);
  await assert.rejects(() => wal.requirePrepared(ACCOUNT, 8453, 0n));
  const created = await prepareRotation({ account: ACCOUNT, chainId: 8453, generation: 0n, keystore, wal });
  const prepared = await wal.requirePrepared(ACCOUNT, 8453, 0n);
  assert.equal(prepared.nextSigner, created.signer);
  const calldata = executeAndRotateCalldata({
    calls: [],
    nextSigner: prepared.nextSigner,
    nextKeyType: prepared.nextKeyType,
  });
  assert.match(calldata, /^0x/);
  await wal.commit(ACCOUNT, 8453);
  await assert.rejects(() => wal.requirePrepared(ACCOUNT, 8453, 0n));
});

test("write-ahead on one chain does not rotate another", async () => {
  const kv = memoryKv();
  const wal = new WriteAheadLog(kv);
  const keystore = softwareHotKeystore(kv);
  await prepareRotation({ account: ACCOUNT, chainId: 8453, generation: 1n, keystore, wal });
  await assert.rejects(() => wal.requirePrepared(ACCOUNT, 1, 1n));
  const base = await wal.requirePrepared(ACCOUNT, 8453, 1n);
  assert.equal(base.chainId, 8453);
});

test("reconcile follows the chain, and only one operation is in flight", () => {
  assert.equal(reconcileGeneration(2n, 1n), "rewind");
  assert.equal(reconcileGeneration(1n, 1n), "current");
  assert.equal(reconcileGeneration(1n, 4n), "catch-up");
  const queue = new InflightQueue();
  queue.begin();
  assert.throws(() => queue.begin(), /in flight/);
  queue.end();
  queue.begin();
});

test("enclave keystore has no private key to export", async () => {
  const bridge = {
    async create() {
      return {
        id: "enclave-1",
        qx: `0x${"01".repeat(32)}` as Hex,
        qy: `0x${"02".repeat(32)}` as Hex,
      };
    },
    async sign() {
      return `0x${"ab".repeat(128)}` as Hex;
    },
  };
  const keystore = enclaveHotKeystore(bridge);
  const created = await keystore.create();
  assert.equal(created.signer, p256SignerAddress(`0x${"01".repeat(32)}`, `0x${"02".repeat(32)}`));
  assert.equal("privateKey" in created, false);
  const signature = await keystore.sign(created.id, `0x${"00".repeat(32)}`);
  assert.equal(signature.length, 2 + 256);
});

test("vault round-trips and rejects the wrong password", async () => {
  const params = { t: 1, m: 8, p: 1 };
  const blob = sealUtf8("correct horse", "abandon phrase stays here", params);
  assert.equal(openUtf8("correct horse", blob), "abandon phrase stays here");
  assert.throws(() => openUtf8("wrong", blob));
  const held = await createVaultKey("correct horse", params);
  const again = sealUtf8WithKey("abandon phrase stays here", held);
  const opened = await openUtf8Async("correct horse", again);
  assert.equal(opened.text, "abandon phrase stays here");
  const resealed = sealUtf8WithKey("second write", opened.held);
  assert.equal((await openUtf8Async("correct horse", resealed)).text, "second write");
  assert.equal(openUtf8WithKey(again, held), "abandon phrase stays here");
  await assert.rejects(() => openUtf8Async("wrong", again));
  const other = await createVaultKey("correct horse", params);
  assert.throws(() => openUtf8WithKey(again, other));
});

test("a paired session cannot see a seed or a private key", () => {
  const state = dappFacingState(ACCOUNT, 8453);
  assertSessionHasNoKeyMaterial(state);
  const leaked = routeSessionRequest({
    method: "knoad_exportMnemonic",
    account: ACCOUNT,
    chainId: 8453,
  });
  assert.equal(leaked.kind, "reject");
  const typed = routeSessionRequest({
    method: "eth_signTypedData_v4",
    account: ACCOUNT,
    chainId: 8453,
    origin: "https://app.example",
    params: [
      ACCOUNT,
      {
        types: { Mail: [{ name: "contents", type: "string" }] },
        primaryType: "Mail",
        domain: { name: "MailApp", version: "1", chainId: 8453, verifyingContract: ACCOUNT },
        message: { contents: "hello" },
      },
    ],
  });
  assert.equal(typed.kind, "sign-typed-data");
  if (typed.kind === "sign-typed-data") assert.match(typed.summary, /Mail/);
  assertSessionHasNoKeyMaterial(typed);
  const oldTyped = routeSessionRequest({
    method: "eth_signTypedData",
    account: ACCOUNT,
    chainId: 8453,
  });
  assert.equal(oldTyped.kind, "reject");
  const switched = routeSessionRequest({
    method: "wallet_switchEthereumChain",
    account: ACCOUNT,
    chainId: 8453,
    params: [{ chainId: "0x1" }],
  });
  assert.equal(switched.kind, "switch-chain");
  const unknown = routeSessionRequest({
    method: "wallet_switchEthereumChain",
    account: ACCOUNT,
    chainId: 8453,
    params: [{ chainId: "0x539" }],
  });
  assert.equal(unknown.kind, "reject");
  const current = routeSessionRequest({ method: "eth_chainId", account: ACCOUNT, chainId: 84532 });
  assert.deepEqual(current, { kind: "chain", chainId: 84532 });
  assertSessionHasNoKeyMaterial(leaked);

  const batch = routeSessionRequest({
    method: "wallet_sendCalls",
    account: ACCOUNT,
    chainId: 8453,
    params: [
      {
        calls: [
          { to: ACCOUNT, value: "1", data: "0x" },
          { to: "0x0000000000000000000000000000000000000001", data: "0xabcd" },
        ],
      },
    ],
  });
  assert.equal(batch.kind, "sign-calls");
  if (batch.kind === "sign-calls") assert.equal(batch.calls.length, 2);
  assertSessionHasNoKeyMaterial(batch);
  const rendered = JSON.stringify(batch, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  assert.equal(rendered.includes("privateKey"), false);
  assert.equal(JSON.stringify(state).includes("mnemonic"), false);
  if (typed.kind === "sign-typed-data") {
    assert.match(describeDecision(typed, "Base"), /MailApp/);
    assert.match(describeDecision(typed, "Base"), /app\.example/);
  }
});

test("ERC-7739 typed data matches the account", () => {
  const fixture = loadJson("typed-data-fixture.json");
  const wrapped = erc7739TypedData({
    account: fixture.account,
    chainId: BigInt(fixture.chainId),
    typedData: {
      domain: {
        name: fixture.appName,
        version: fixture.appVersion,
        chainId: BigInt(fixture.chainId),
        verifyingContract: fixture.appVerifier,
      },
      types: {
        Person: [
          { name: "name", type: "string" },
          { name: "wallet", type: "address" },
        ],
        Mail: [
          { name: "from", type: "Person" },
          { name: "contents", type: "string" },
        ],
      },
      primaryType: "Mail",
      message: {
        from: { name: fixture.fromName, wallet: fixture.fromWallet },
        contents: fixture.contents,
      },
    },
  });
  assert.equal(wrapped.digest, fixture.digest);
  assert.equal(wrapped.appHash, fixture.appHash);
  assert.equal(wrapped.contentsDescr, fixture.contentsDescr);
  const encoded = encodeTypedDataSignature({
    signature: fixture.rawSignature,
    appSeparator: wrapped.appSeparator,
    contentsHash: wrapped.contentsHash,
    contentsDescr: wrapped.contentsDescr,
  });
  assert.equal(encoded, fixture.encodedSignature);
});

test("chain registry keeps bundler URLs out of the source and gates P-256", () => {
  assert.equal(hotKeyTypeForChain(1), 2);
  assert.equal(hotKeyTypeForChain(8453), 2);
  assert.throws(() => hotKeyTypeForChain(10));
  const base = resolveChain(8453, { KNOAD_RPC_8453: "https://rpc.example", KNOAD_BUNDLER_8453: "https://bundler.example" });
  assert.equal(base.rpcUrl, "https://rpc.example");
  assert.equal(base.bundlerUrl, "https://bundler.example");
  assert.equal(base.entryPoint, "0x433709009B8330FDa32311DF1C2AFA402eD8D009");
  const unset = resolveChain(1, {});
  assert.equal(unset.rpcUrl, null);
  assert.equal(unset.bundlerUrl, null);
  assert.equal(deployments.factory, getAddress("0x640b63604581cC0b1326025a57C188BCc6160Dc9"));
  assert.equal(deployments.verifier, getAddress("0x39305881423DC27C6238bE3A343787772534e764"));
  assert.equal(deployments.implementation, getAddress("0x70044945917051ce6DcCD244C4d4288FE14A9f28"));
});

test("vault records keep a separate generation per chain", () => {
  const migrated = migrateVaultRecord({
    accountIndex: 0,
    account: ACCOUNT,
    recovery: ACCOUNT,
    initialHotAddress: ACCOUNT,
    initialHotKey: "0xabc",
    currentKeyId: "p256:1",
    currentKeyType: 2,
    localGeneration: "4",
  });
  assert.equal(migrated.v, 3);
  assert.equal("initialHotAddress" in migrated, false);
  assert.equal(chainState(migrated, 8453).generation, "4");
  assert.equal(migrated.selectedChainId, 8453);
  assert.equal(chainState(migrated, 1).generation, "0");
  const next = withChainState(migrated, 1, { generation: "1", hotKeyId: "secp:1", keyType: 1, deployed: true });
  assert.equal(chainState(next, 8453).generation, "4");
  assert.equal(chainState(next, 1).deployed, true);
  assert.equal(migrated.recoveryEpoch, "0");
  assert.equal(migrated.originalRecovery, getAddress(ACCOUNT));
  const predicted = predictDeployedAccount({ recovery: ACCOUNT });
  assert.match(predicted, /^0x[0-9a-fA-F]{40}$/);
});

test("an empty rotation encodes a zero-length execution payload", () => {
  const data = executeAndRotateCalldata({
    calls: [],
    nextSigner: ACCOUNT,
    nextKeyType: 1,
  });
  const decoded = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "executeAndRotate",
        inputs: [
          { name: "mode", type: "bytes32" },
          { name: "executionData", type: "bytes" },
          { name: "nextSigner", type: "address" },
          { name: "nextKeyType", type: "uint8" },
        ],
      },
    ],
    data,
  });
  assert.ok(decoded.args);
  assert.equal(decoded.args[1], "0x");
});

test("cross-chain follow-ups stay on the chains that have not moved", () => {
  const base = {
    chainId: 8453,
    name: "Base",
    checked: true,
    deployed: true,
    initialHotLive: false,
    recoveryAuthority: ACCOUNT,
    recoveryEpoch: 1n,
  };
  const ethereum = {
    chainId: 1,
    name: "Ethereum",
    checked: true,
    deployed: false,
    initialHotLive: true,
    recoveryAuthority: null,
    recoveryEpoch: null,
  };
  const sepolia = {
    chainId: 11155111,
    name: "Sepolia",
    checked: true,
    deployed: true,
    initialHotLive: true,
    recoveryAuthority: ACCOUNT,
    recoveryEpoch: 0n,
  };
  assert.equal(initialHotIsLive({ deployed: false, hotSigner: null, initialHot: ACCOUNT }), true);
  assert.equal(initialHotIsLive({ deployed: true, hotSigner: ACCOUNT, initialHot: ACCOUNT }), true);
  assert.deepEqual(
    chainsToRetire([base, ethereum, sepolia]).map((view) => view.chainId),
    [1, 11155111],
  );
  assert.deepEqual(chainsToRetire([ethereum, sepolia]), []);
  assert.deepEqual(
    chainsOneRecoveryBehind([base, sepolia], 1n).map((view) => view.chainId),
    [11155111],
  );
  assert.deepEqual(
    chainsRecoveryBehind([ethereum, sepolia], 1n).map((view) => view.chainId),
    [1, 11155111],
  );
});

test("one sitting chooses one action per chain and does not jump a gap", () => {
  const deployedAt = (chainId: number, epoch: bigint) => ({
    chainId,
    name: String(chainId),
    checked: true,
    deployed: true,
    initialHotLive: true,
    recoveryAuthority: ACCOUNT,
    recoveryEpoch: epoch,
  });
  const four = [deployedAt(1, 0n), deployedAt(8453, 0n), deployedAt(11155111, 0n), deployedAt(84532, 0n)];
  assert.equal(cutoffTarget(four, 0n), 1n);
  assert.deepEqual(
    four.map((view) => classifyChainCutoff(view, 1n)),
    ["recover-one-step", "recover-one-step", "recover-one-step", "recover-one-step"],
  );
  const undeployed = { ...deployedAt(1, 0n), deployed: false, recoveryEpoch: null, initialHotLive: true };
  assert.equal(classifyChainCutoff(undeployed, 1n), "deploy-and-retire");
  assert.equal(classifyChainCutoff(deployedAt(8453, 0n), 2n), "one-step-of-longer-gap");
  assert.equal(recoveryInstallEpoch(deployedAt(8453, 0n), 2n), 1n);
  assert.deepEqual(recoverySteps(0n, 3n), [0n, 1n, 2n]);
  assert.deepEqual(recoverySteps(2n, 2n), []);
  assert.equal(classifyChainCutoff({ ...deployedAt(8453, 0n), checked: false }, 1n), "not-checked");
  assert.equal(classifyChainCutoff(deployedAt(8453, 1n), 1n), "already-here");
});

test("secure all networks distinguishes a closed chain, a self-funded chain, and an outside payment", () => {
  const open = { checked: true, deployed: false, secured: false, nativeBalance: 0n, holdsTokens: false, tokensKnown: true };
  assert.deepEqual(classifySecureNetwork({ ...open, checked: false }), { status: "not-checked" });
  assert.deepEqual(classifySecureNetwork({ ...open, secured: true }), { status: "closed" });
  assert.deepEqual(classifySecureNetwork({ ...open, deployed: true }), { status: "closed" });
  assert.deepEqual(classifySecureNetwork({ ...open, nativeBalance: 1n }), { status: "self-funded" });
  assert.deepEqual(classifySecureNetwork({ ...open, holdsTokens: true, tokensKnown: false }), {
    status: "needs-outside-payer",
    reason: "tokens",
  });
  assert.deepEqual(classifySecureNetwork(open), { status: "needs-outside-payer", reason: "empty" });
});
