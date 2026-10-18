import { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { encodeFunctionData, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import {
  CHAINS,
  WriteAheadLog,
  accountAbi,
  accountInitCode,
  activationDigest,
  buildRecoveryRequest,
  buildUserOp,
  firstUseDraft,
  chainState,
  classifyChainCutoff,
  classifySecureNetwork,
  cutoffTarget,
  createVaultKey,
  deployments,
  EXECUTE_OVERHEAD,
  explainBundlerError,
  feeQuote,
  formatUnits,
  deriveRecovery,
  deriveRecoveryAsync,
  describeDecision,
  emptyChainState,
  assertCallGas,
  bufferedGas,
  decodeExecuteCalls,
  executeAndRotateCalldata,
  factoryAbi,
  generateRecoveryMnemonic,
  getChain,
  hotKeyTypeForChain,
  initialHotIsLive,
  migrateVaultRecord,
  openUtf8Async,
  prepareActivations,
  prepareRotation,
  operationGas,
  paymentCallGas,
  quoteOperationGas,
  reconcileGeneration,
  recoveryDigest,
  recoverySteps,
  routeSessionRequest,
  sealUtf8WithKey,
  tokensForChain,
  type VaultKey,
  signSecp256k1,
  userOpHash,
  withChainState,
  type ChainAccountState,
  type ChainAuthorityView,
  type KeyType,
  type PreparedKey,
  type PackedUserOperation,
  type PendingSend,
  type SessionDecision,
  type Call,
  type VaultRecord,
  BundlerRefusal,
} from "@knoad/wallet-core";
import { appendActivity, loadActivity, markActivity, patchActivity, pendingRows } from "./activityLog";
import { bioFailureMessage, clearBioKey, isBioCancel, openWithHeldKey, readBioFlag, readBioKey, saveBioKey } from "./biometric";
import { DEFAULT_CHAIN_ID, WALLETCONNECT_PROJECT_ID, chainEnv } from "./config";
import { predictAccount, chainRpc, readAccountFacts, readBalances, readDeployed, readGeneration, readHoldsListedTokens, readHotSigner, readNativeBalance, readUserOpLog } from "./chain";
import { secureStoreKv, selectHotKeystore } from "./deviceKeys";
import { secpSigner, signPersonal, signRotatingOperation, signTypedData, submitPriced } from "./send";
import { forgetSite, loadSites, rememberSite, type SavedSite } from "./sites";
import { pairWalletConnect, type WalletConnectSession } from "./walletConnect";
import type { CutoffRow } from "./screens/CutoffSheet";

const VAULT_KEY = "knoad.vault";
const SITE_READS = new Set([
  "eth_call",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionCount",
  "eth_feeHistory",
  "eth_getLogs",
]);
/** Phone argon2id. The old 19 MiB cost stalls Hermes. The blob keeps its own parameters. */
const VAULT_PARAMS = { t: 1, m: 4096, p: 1 };
const ONE_DAY = 86_400;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export type PhoneChainView = ChainAuthorityView & { canSpend: boolean; needsWords: boolean };
export type Screen = "create" | "backup" | "unlock" | "home" | "send" | "pair" | "recover" | "swap" | "bridge" | "buy" | "nfts" | "security";
export type Holding = {
  key: string;
  chainId: number;
  chainName: string;
  symbol: string;
  amount: bigint;
  decimals: number;
  text: string;
  native: boolean;
  unavailable: boolean;
};
const RECOVERY_VERIFIED = "knoad.recovery.verified";

function chainNeedsWords(state: ChainAccountState, deployed: boolean): boolean {
  return !deployed && !state.initialKey && !state.activationSignature && !state.hotKeyId;
}

async function flooredCallGas(rpcUrl: string | null, from: Address, callData: Hex, current: bigint): Promise<bigint> {
  if (!rpcUrl) return current;
  const decoded = decodeExecuteCalls(callData);
  const floor = bufferedGas(decoded ? await paymentCallGas({ rpcUrl, from, calls: decoded }) : EXECUTE_OVERHEAD + 500_000n);
  return floor > current ? floor : current;
}

function accountAlreadyThere(error: unknown): boolean {
  const message = error instanceof BundlerRefusal ? error.raw : error instanceof Error ? error.message : "";
  return /AA10|already constructed|already exists|sender already|account already/i.test(message);
}

function phoneCanSpend(state: ChainAccountState, facts: { deployed: boolean; hotSigner: Address | null }): boolean {
  if (!facts.deployed) return Boolean(state.initialKey);
  if (!facts.hotSigner) return false;
  const hot = getAddress(facts.hotSigner);
  if (state.initialKey && state.initialSigner && hot === getAddress(state.initialSigner)) return true;
  if (state.hotKeyId && state.currentSigner && hot === getAddress(state.currentSigner)) return true;
  if (state.hotKeyId && !state.currentSigner && !state.initialKey) return true;
  return false;
}

function rememberSend(
  source: VaultRecord,
  selected: number,
  op: PackedUserOperation,
  hash: string,
  nextSigner: Address,
  nextKeyType: KeyType,
  kind: PendingSend["kind"],
  meta?: { to?: string; asset?: string; amount?: string },
): VaultRecord {
  const gas = operationGas(op);
  const state = chainState(source, selected);
  return withChainState(source, selected, {
    ...state,
    pendingSend: {
      nonce: op.nonce.toString(),
      callData: op.callData,
      initCode: op.initCode,
      nextSigner,
      nextKeyType,
      verificationGasLimit: gas.verificationGasLimit.toString(),
      callGasLimit: gas.callGasLimit.toString(),
      preVerificationGas: gas.preVerificationGas.toString(),
      maxPriorityFeePerGas: gas.maxPriorityFeePerGas.toString(),
      maxFeePerGas: gas.maxFeePerGas.toString(),
      userOpHash: hash,
      kind,
      sentAt: Date.now(),
      to: meta?.to,
      asset: meta?.asset,
      amount: meta?.amount,
    },
  });
}

async function chainsFromWords(phrase: string, account: Address): Promise<Record<string, ChainAccountState>> {
  const prepared = await prepareActivations(
    phrase,
    account,
    CHAINS.map((item) => item.chainId),
  );
  const chains: Record<string, ChainAccountState> = {};
  for (const item of prepared) {
    chains[String(item.chainId)] = {
      ...emptyChainState(1),
      initialSigner: item.initialSigner,
      initialKey: item.initialKey,
      activationSignature: item.activationSignature,
    };
  }
  return chains;
}

function blankView(chainId: number, name: string): PhoneChainView {
  return {
    chainId,
    name,
    checked: false,
    deployed: false,
    initialHotLive: false,
    recoveryAuthority: null,
    recoveryEpoch: null,
    canSpend: false,
    needsWords: false,
  };
}

export function useWallet() {
  const kv = useMemo(() => secureStoreKv(SecureStore), []);
  const keys = useMemo(() => selectHotKeystore(kv), [kv]);
  const wal = useMemo(() => new WriteAheadLog(kv), [kv]);

  const [screen, setScreen] = useState<Screen>("create");
  const [booted, setBooted] = useState(false);
  const [hasVault, setHasVault] = useState(false);
  const [password, setPassword] = useState("");
  const passwordRef = useRef("");
  const [mnemonic, setMnemonic] = useState("");
  const [checkIndex, setCheckIndex] = useState(0);
  const [checkWord, setCheckWord] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [unlockMessage, setUnlockMessage] = useState("");
  const [unlockError, setUnlockError] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const unlocking = useRef(false);
  const heldKey = useRef<VaultKey | null>(null);
  const heldPassword = useRef("");
  const [record, setRecord] = useState<VaultRecord | null>(null);
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [uri, setUri] = useState("");
  const [session, setSession] = useState<WalletConnectSession | null>(null);
  const [prompt, setPrompt] = useState<{ summary: string; resolve: (accepted: boolean) => void; site?: { name: string; url: string } } | null>(null);
  const [balances, setBalances] = useState<Holding[]>([]);
  const [balancesReady, setBalancesReady] = useState(false);
  const [sites, setSites] = useState<SavedSite[]>([]);
  const [bioOn, setBioOn] = useState(false);
  const [browserOrigins, setBrowserOrigins] = useState<string[]>([]);
  const grantedOrigins = useRef(new Set<string>());
  const [pairMessage, setPairMessage] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [chainReport, setChainReport] = useState<PhoneChainView[]>([]);
  const [cutoff, setCutoff] = useState<CutoffRow[] | null>(null);
  const [cutoffKind, setCutoffKind] = useState<"spend" | "secure">("spend");

  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(VAULT_KEY)
      .then((raw) => {
        if (!live) return;
        const found = Boolean(raw);
        setHasVault(found);
        if (found) setScreen((current) => (current === "create" ? "unlock" : current));
      })
      .then(() => Promise.all([readBioFlag(), loadSites()]))
      .then(([bio, savedSites]) => {
        if (!live) return;
        setBioOn(bio);
        setSites(savedSites);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setBooted(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const chainId = record?.selectedChainId ?? DEFAULT_CHAIN_ID;
  const chain = getChain(chainId) ?? CHAINS[3];
  const current = record ? chainState(record, chainId) : emptyChainState();
  const reported = chainReport.find((view) => view.chainId === chainId);
  const canSpend = reported?.checked ? reported.canSpend : Boolean(current.hotKeyId || current.initialKey);

  function ask(decision: SessionDecision): Promise<boolean> {
    const name = getChain(decision.kind === "reject" ? chainId : decision.chainId)?.name ?? chain.name;
    return new Promise((resolve) => setPrompt({ summary: describeDecision(decision, name), resolve }));
  }

  function askSite(peer: { name: string; url: string }): Promise<boolean> {
    return new Promise((resolve) => setPrompt({ summary: `Connect to ${peer.name}`, resolve, site: peer }));
  }

  function answer(accepted: boolean) {
    prompt?.resolve(accepted);
    setPrompt(null);
  }

  async function persist(next: VaultRecord, passphrase = passwordRef.current, onProgress?: (progress: number) => void) {
    if (!heldKey.current || heldPassword.current !== passphrase) {
      if (!passphrase) throw new Error("Choose a password. It only unlocks this phone.");
      heldKey.current = await createVaultKey(passphrase, VAULT_PARAMS, onProgress);
      heldPassword.current = passphrase;
      if (await readBioFlag()) {
        await clearBioKey();
        setBioOn(false);
      }
    }
    await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(sealUtf8WithKey(JSON.stringify(next), heldKey.current)));
    setHasVault(true);
    setRecord(next);
  }

  function replacePassword(value: string) {
    passwordRef.current = value;
    setPassword(value);
  }

  function updatePassword(value: string) {
    if (value === "" && passwordRef.current.length > 1) return;
    replacePassword(value);
  }

  function initFor(source: VaultRecord, selected: number, deployed: boolean): Hex {
    if (deployed) return "0x";
    const state = chainState(source, selected);
    if (!state.initialSigner || !state.activationSignature || !state.initialKey) {
      throw new Error("Use your 24 words to set up this chain.");
    }
    return accountInitCode({
      factory: deployments.factory,
      recovery: source.originalRecovery,
      initialSigner: state.initialSigner,
      keyType: 1,
      signature: state.activationSignature,
    });
  }

  function updateCheckWord(value: string) {
    setCheckWord(value);
    setBackupMessage("");
    setBackupError(false);
  }

  function showUnlock() {
    replacePassword("");
    setUnlockMessage("");
    setUnlockError(false);
    setNote("");
    setScreen("unlock");
  }

  function showCreate() {
    replacePassword("");
    setCreateMessage("");
    setNote("");
    setScreen("create");
  }

  function startCreate() {
    const passphrase = passwordRef.current;
    if (!passphrase) {
      setCreateMessage("Choose a password. It only unlocks this phone.");
      return;
    }
    setCreateMessage("");
    const phrase = generateRecoveryMnemonic();
    const words = phrase.split(" ");
    setMnemonic(phrase);
    setCheckIndex(words.length - 1);
    setCheckWord("");
    setBackupMessage("");
    setBackupError(false);
    setBackupBusy(false);
    setNote("");
    setScreen("backup");
  }

  async function finishBackup() {
    if (backupBusy) return;
    const words = mnemonic.trim().split(/\s+/);
    const expected = words[checkIndex] ?? "";
    if (checkWord.trim().toLowerCase() !== expected.toLowerCase()) {
      setBackupError(true);
      setBackupMessage("That word does not match. Try again.");
      return;
    }
    const passphrase = passwordRef.current;
    if (!passphrase) {
      setBackupError(true);
      setBackupMessage("Choose a password. It only unlocks this phone.");
      return;
    }
    setBackupBusy(true);
    setBackupError(false);
    setBackupMessage("Preparing keys.");
    setNote("");
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      const recovery = await deriveRecoveryAsync(mnemonic, 0, 0);
      const predicted = predictAccount(recovery.address);
      const chains = await chainsFromWords(mnemonic, predicted);
      const next: VaultRecord = {
        v: 3,
        accountIndex: 0,
        account: predicted,
        recovery: recovery.address,
        originalRecovery: recovery.address,
        recoveryEpoch: "0",
        selectedChainId: DEFAULT_CHAIN_ID,
        chains,
      };
      let shown = -1;
      setBackupMessage("Encrypting 0%.");
      await persist(next, passphrase, (progress) => {
        const pct = Math.round(progress * 100);
        if (pct === shown) return;
        shown = pct;
        setBackupMessage(`Encrypting ${pct}%.`);
      });
      setMnemonic("");
      setBackupMessage("");
      setScreen("home");
      void AsyncStorage.setItem(RECOVERY_VERIFIED, String(Date.now())).catch(() => undefined);
      const refreshNote = await refresh(next);
      if (!refreshNote) setNote("Wallet ready. You can receive now. Each chain gets its own key on the first send.");
    } catch (error) {
      setBackupError(true);
      setBackupMessage(error instanceof Error ? error.message : "Could not create the wallet.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function unlock() {
    if (unlockBusy) return;
    const passphrase = passwordRef.current;
    if (!passphrase) {
      setUnlockError(true);
      setUnlockMessage("Enter the phone password.");
      return;
    }
    setUnlockBusy(true);
    setUnlockError(false);
    setUnlockMessage("Unlocking 0%.");
    setNote("");
    try {
      const raw = await SecureStore.getItemAsync(VAULT_KEY);
      if (!raw) {
        setHasVault(false);
        replacePassword("");
        setCreateMessage("No wallet on this phone yet.");
        setNote("");
        setScreen("create");
        return;
      }
      let shown = -1;
      const opened = await openUtf8Async(passphrase, JSON.parse(raw), (progress) => {
        const pct = Math.round(progress * 100);
        if (pct === shown) return;
        shown = pct;
        setUnlockMessage(`Unlocking ${pct}%.`);
      });
      const next = migrateVaultRecord(JSON.parse(opened.text));
      const savedLock = opened.held.params;
      const sameLock = savedLock.t === VAULT_PARAMS.t && savedLock.m === VAULT_PARAMS.m && savedLock.p === VAULT_PARAMS.p;
      if (sameLock) {
        heldKey.current = opened.held;
        heldPassword.current = passphrase;
        setRecord(next);
      } else {
        setUnlockMessage("Saving a faster lock.");
        await persist(next, passphrase);
      }
      setUnlockMessage("");
      setScreen("home");
      if (next.account) await refresh(next);
    } catch (error) {
      const rejected = error instanceof Error && error.message === "Vault password did not open this file.";
      setUnlockError(true);
      setUnlockMessage(rejected ? "Wrong password." : error instanceof Error ? error.message : "Could not unlock.");
    } finally {
      setUnlockBusy(false);
    }
  }

  async function adoptIncludedKeys(source: VaultRecord): Promise<VaultRecord> {
    if (!source.account) return source;
    let next = source;
    for (const item of CHAINS) {
      const state = chainState(next, item.chainId);
      if (!chainEnv(item.chainId).rpcUrl) continue;
      let prepared: Awaited<ReturnType<WriteAheadLog["requirePrepared"]>> | null = null;
      try {
        prepared = await wal.requirePrepared(source.account, item.chainId, BigInt(state.generation));
      } catch {
        prepared = null;
      }
      const queued = Boolean(state.recoveryQueue && state.recoveryQueue.length > 0);
      if (!queued && (!state.pendingSigner || !state.pendingHotKeyId) && !prepared) continue;
      try {
        const deployed = await readDeployed(item.chainId, source.account);
        if (!deployed) continue;
        const hot = getAddress(await readHotSigner(item.chainId, source.account));
        if (prepared && getAddress(prepared.nextSigner) === hot) {
          const chainGeneration = await readGeneration(item.chainId, source.account);
          const queue =
            state.recoveryQueue && state.recoveryQueue.length > 0
              ? state.recoveryQueue
              : state.pendingSigner && state.pendingHotKeyId
                ? [{ id: state.pendingHotKeyId, signer: state.pendingSigner, keyType: state.pendingKeyType ?? state.keyType }]
                : [];
          const index = queue.findIndex((step) => getAddress(step.signer) === hot);
          const rest = index >= 0 ? queue.slice(index + 1) : [];
          if (state.pendingSend) await recordPendingOutcome(item.chainId, state.pendingSend);
          next = withChainState(next, item.chainId, {
            ...state,
            generation: chainGeneration.toString(),
            hotKeyId: prepared.nextKeyId,
            keyType: prepared.nextKeyType,
            currentSigner: prepared.nextSigner,
            deployed: true,
            initialKey: null,
            activationSignature: null,
            pendingHotKeyId: rest[0]?.id ?? null,
            pendingSigner: rest[0]?.signer ?? null,
            pendingKeyType: rest[0]?.keyType ?? null,
            recoveryQueue: rest.length > 0 ? rest : null,
            pendingSend: null,
          });
          continue;
        }
        const queue =
          state.recoveryQueue && state.recoveryQueue.length > 0
            ? state.recoveryQueue
            : state.pendingSigner && state.pendingHotKeyId
              ? [{ id: state.pendingHotKeyId, signer: state.pendingSigner, keyType: state.pendingKeyType ?? state.keyType }]
              : [];
        const index = queue.findIndex((step) => getAddress(step.signer) === hot);
        if (index < 0) continue;
        if (state.pendingSend) await recordPendingOutcome(item.chainId, state.pendingSend);
        const match = queue[index];
        const rest = queue.slice(index + 1);
        next = withChainState(next, item.chainId, {
          ...state,
          hotKeyId: match.id,
          keyType: match.keyType,
          currentSigner: match.signer,
          deployed: true,
          initialKey: null,
          activationSignature: null,
          pendingHotKeyId: rest[0]?.id ?? null,
          pendingSigner: rest[0]?.signer ?? null,
          pendingKeyType: rest[0]?.keyType ?? null,
          recoveryQueue: rest.length > 0 ? rest : null,
          pendingSend: null,
        });
      } catch {
        continue;
      }
    }
    return next;
  }

  async function scanChains(source = record): Promise<PhoneChainView[]> {
    if (!source?.account) {
      setChainReport([]);
      return [];
    }
    const adopted = await adoptIncludedKeys(source);
    if (adopted !== source) {
      await persist(adopted);
      source = adopted;
    }
    if (!source.account) return [];
    const views: PhoneChainView[] = [];
    for (const item of CHAINS) {
      if (!chainEnv(item.chainId).rpcUrl) {
        views.push(blankView(item.chainId, item.name));
        continue;
      }
      try {
        const facts = await readAccountFacts(item.chainId, source.account);
        const state = chainState(source, item.chainId);
        views.push({
          chainId: item.chainId,
          name: item.name,
          checked: true,
          deployed: facts.deployed,
          initialHotLive: initialHotIsLive({
            deployed: facts.deployed,
            hotSigner: facts.hotSigner,
            initialHot: state.initialSigner ?? ZERO,
          }),
          recoveryAuthority: facts.recoveryAuthority,
          recoveryEpoch: facts.recoveryEpoch,
          canSpend: phoneCanSpend(state, facts),
          needsWords: chainNeedsWords(state, facts.deployed),
        });
      } catch {
        views.push(blankView(item.chainId, item.name));
      }
    }
    setChainReport(views);
    return views;
  }

  function decimalNonce(value: unknown): string {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
    if (typeof value !== "string") return "";
    const text = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(text)) return BigInt(text).toString();
    if (/^\d+$/.test(text)) return text;
    return "";
  }

  async function userOpOutcome(selected: number, hash: string, aroundMs?: number): Promise<{ found: boolean; success: boolean; reason: string; txHash: string; nonce: string }> {
    const empty = { found: false, success: false, reason: "", txHash: "", nonce: "" };
    const bundler = chainEnv(selected).bundlerUrl;
    if (!hash) return empty;
    if (!bundler) return loggedUserOp(selected, hash, aroundMs);
    try {
      const response = await fetch(bundler, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getUserOperationReceipt", params: [hash] }),
      });
      const body = (await response.json()) as {
        result?: { success?: boolean; reason?: unknown; nonce?: unknown; receipt?: { transactionHash?: string } } | null;
      };
      if (!body.result) return loggedUserOp(selected, hash, aroundMs);
      return {
        found: true,
        success: body.result.success === true,
        reason: typeof body.result.reason === "string" ? body.result.reason : "",
        txHash: body.result.receipt?.transactionHash ?? "",
        nonce: decimalNonce(body.result.nonce),
      };
    } catch {
      return loggedUserOp(selected, hash, aroundMs);
    }
  }

  async function loggedUserOp(selected: number, hash: string, aroundMs?: number): Promise<{ found: boolean; success: boolean; reason: string; txHash: string; nonce: string }> {
    const logged = await readUserOpLog(selected, hash, aroundMs);
    if (!logged) return { found: false, success: false, reason: "", txHash: "", nonce: "" };
    return { found: true, success: logged.success, reason: "", txHash: logged.txHash, nonce: logged.nonce };
  }

  async function recordPendingOutcome(selected: number, pending: { userOpHash: string; kind: string; sentAt?: number }): Promise<{ found: boolean; success: boolean }> {
    const outcome = await userOpOutcome(selected, pending.userOpHash, pending.sentAt);
    if (!outcome.found) return outcome;
    const status = pending.kind === "cancel" ? "cancelled" : outcome.success ? "included" : "failed";
    await patchActivity(pending.userOpHash, { status, reason: outcome.reason, txHash: outcome.txHash, nonce: outcome.nonce || undefined });
    return outcome;
  }

  async function settleActivity(): Promise<boolean> {
    if (!record) return false;
    const entries = await loadActivity();
    const live = new Set(pendingRows(record).map((row) => row.pending.userOpHash));
    let changed = false;
    for (const entry of entries) {
      if (entry.status !== "pending" || live.has(entry.hash)) {
        if (entry.nonce) continue;
        const prior = await userOpOutcome(entry.chainId, entry.hash, entry.time);
        if (!prior.nonce) continue;
        await patchActivity(entry.hash, { nonce: prior.nonce });
        changed = true;
        continue;
      }
      const outcome = await userOpOutcome(entry.chainId, entry.hash, entry.time);
      if (!outcome.found) {
        const stillWaiting = pendingRows(record).some((row) => row.chainId === entry.chainId);
        if (stillWaiting) continue;
        await patchActivity(entry.hash, { status: "failed", reason: "This nonce was already used. It cannot be sped up or cancelled.", nonce: outcome.nonce || undefined });
        changed = true;
        continue;
      }
      await patchActivity(entry.hash, {
        status: outcome.success ? "included" : entry.kind === "cancel" ? "cancelled" : "failed",
        reason: outcome.reason,
        txHash: outcome.txHash,
        nonce: outcome.nonce || entry.nonce,
      });
      changed = true;
    }
    return changed;
  }

  async function refresh(currentRecord = record): Promise<string | null> {
    if (!currentRecord?.account || !isAddress(currentRecord.account)) return null;
    const account = currentRecord.account;
    void loadBalances(account);
    currentRecord = await adoptIncludedKeys(currentRecord);
    const selected = currentRecord.selectedChainId;
    const localState = chainState(currentRecord, selected);
    const local = BigInt(localState.generation);
    let chainGeneration = 0n;
    let deployed = localState.deployed;
    try {
      chainGeneration = await readGeneration(selected, account);
      deployed = await readDeployed(selected, account);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach this chain.";
      setNote(message);
      return message;
    }
    const relation = reconcileGeneration(local, chainGeneration);
    let next = withChainState(currentRecord, selected, { ...localState, deployed });
    if (relation === "rewind") {
      await persist(next);
      await scanChains(next);
      const message = "This chain has not caught up. Refresh in a moment.";
      setNote(message);
      return message;
    }
    if (relation === "catch-up" && chainGeneration === local + 1n) {
      try {
        const prepared = await wal.requirePrepared(account, selected, local);
        next = withChainState(next, selected, {
          generation: chainGeneration.toString(),
          hotKeyId: prepared.nextKeyId,
          keyType: prepared.nextKeyType,
          currentSigner: prepared.nextSigner,
          deployed: true,
          initialKey: null,
          activationSignature: null,
          pendingSend: null,
          pendingHotKeyId: null,
          pendingSigner: null,
          pendingKeyType: null,
        });
      } catch {
        await persist(next);
        const message = "This phone is missing the next key. Use your 24 words.";
        setNote(message);
        return message;
      }
      await persist(next);
      await wal.commit(account, selected);
      await scanChains(next);
      const pending = localState.pendingSend;
      let message = "This chain switched keys. Other chains switch on their own.";
      if (pending && pending.nonce === local.toString()) {
        const outcome = await recordPendingOutcome(selected, pending);
        if (pending.kind === "cancel" && outcome.found) message = "Cancelled. The old key has stopped.";
        else if (outcome.found && !outcome.success) message = "The key changed. The payment did not go through.";
      }
      setNote(message);
      return message;
    }
    await persist(next);
    await scanChains(next);
    void loadBalances(account);
    if (relation === "catch-up") {
      const message = "This phone is behind. Use your 24 words.";
      setNote(message);
      return message;
    }
    return null;
  }

  async function signCurrent(digest: Hex, selected = chainId, source = record): Promise<Hex> {
    if (!source) throw new Error("Unlock this phone first.");
    const state = chainState(source, selected);
    if (state.hotKeyId) return keys.keystore.sign(state.hotKeyId, digest);
    if (state.initialKey) return secpSigner(state.initialKey)(digest);
    throw new Error("Use your 24 words to spend on this chain.");
  }

  async function assertHoldsKey(source: VaultRecord, selected: number) {
    const state = chainState(source, selected);
    if (!source.account) throw new Error("Unlock this phone first.");
    if (!state.hotKeyId && !state.initialKey) throw new Error("Use your 24 words to spend on this chain.");
    if (!chainEnv(selected).rpcUrl) return;
    const facts = await readAccountFacts(selected, source.account);
    if (!facts.deployed) return;
    if (!facts.hotSigner) throw new Error("Use your 24 words to spend on this chain.");
    const hot = getAddress(facts.hotSigner);
    if (state.hotKeyId && state.currentSigner && hot === getAddress(state.currentSigner)) return;
    if (!state.hotKeyId && state.initialSigner && hot === getAddress(state.initialSigner)) return;
    if (state.hotKeyId && !state.currentSigner) return;
    throw new Error("Use your 24 words to spend on this chain.");
  }

  async function signAndMaybeSend(
    source: VaultRecord,
    selected: number,
    calls: Call[],
    meta?: { to?: string; asset?: string; amount?: string },
  ): Promise<{ hash: string | null; next: VaultRecord | null }> {
    if (!source.account) throw new Error("Unlock this phone first.");
    const adopted = await adoptIncludedKeys(source);
    if (adopted !== source) await persist(adopted);
    source = adopted;
    const account = source.account;
    if (!account) throw new Error("Unlock this phone first.");
    const state = chainState(source, selected);
    if (state.pendingSend) throw new Error("A send is waiting. Speed it up or cancel it first.");
    await assertHoldsKey(source, selected);
    const env = chainEnv(selected);
    const generation = BigInt(state.generation);
    const chainName = getChain(selected)?.name;
    const signOnce = (initCode: Hex) =>
      signRotatingOperation({
        account,
        chainId: selected,
        generation,
        initCode,
        calls,
        keystore: keys.keystore,
        wal,
        currentKeyType: state.keyType,
        signCurrent: (digest) => signCurrent(digest, selected, source),
        chainName,
        bundlerUrl: env.bundlerUrl,
        rpcUrl: env.rpcUrl,
      });
    let op = await signOnce(initFor(source, selected, state.deployed));
    if (!env.bundlerUrl) return { hash: null, next: null };
    const deliver = (signed: PackedUserOperation, initCode: Hex) =>
      submitPriced({
        bundlerUrl: env.bundlerUrl!,
        op: signed,
        chainName,
        resign: (gas) =>
          signRotatingOperation({
            account,
            chainId: selected,
            generation,
            initCode,
            calls,
            keystore: keys.keystore,
            wal,
            currentKeyType: state.keyType,
            signCurrent: (digest) => signCurrent(digest, selected, source),
            gas,
            chainName,
          }),
      });
    let sent: { hash: string; op: PackedUserOperation };
    try {
      sent = await deliver(op, op.initCode);
    } catch (error) {
      if (!accountAlreadyThere(error) || op.initCode === "0x") throw error;
      const facts = await readAccountFacts(selected, account);
      if (!facts.deployed) throw error;
      source = withChainState(source, selected, { ...chainState(source, selected), deployed: true });
      op = await signOnce("0x");
      sent = await deliver(op, "0x");
    }
    const prepared = await wal.requirePrepared(account, selected, generation);
    return {
      hash: sent.hash,
      next: rememberSend(source, selected, sent.op, sent.hash, prepared.nextSigner, prepared.nextKeyType, "send", meta),
    };
  }

  async function send(draft?: { to?: string; amount?: string; symbol?: string; toName?: string }) {
    try {
      const recipient = (draft?.to ?? to).trim();
      if (!record?.account || !isAddress(recipient)) {
        setNote("Enter who should receive this.");
        return;
      }
      const symbol = draft?.symbol || "ETH";
      const amountText = (draft?.amount ?? "").trim();
      if (!amountText) {
        setNote("Enter an amount.");
        return;
      }
      const listed = tokensForChain(chainId).find((token) => token.symbol === symbol);
      const decimals = listed?.decimals ?? 18;
      const amount = parseUnits(amountText, decimals);
      if (amount <= 0n) {
        setNote("Enter an amount.");
        return;
      }
      const calls: Call[] =
        !listed || listed.native
          ? [{ target: getAddress(recipient), value: amount, data: "0x" }]
          : [
              {
                target: listed.address,
                value: 0n,
                data: encodeFunctionData({
                  abi: [
                    {
                      type: "function",
                      name: "transfer",
                      stateMutability: "nonpayable",
                      inputs: [
                        { name: "to", type: "address" },
                        { name: "amount", type: "uint256" },
                      ],
                      outputs: [{ type: "bool" }],
                    },
                  ],
                  functionName: "transfer",
                  args: [getAddress(recipient), amount],
                }),
              },
            ];
      await assertCanPayFee(record, chainId, calls, !listed || listed.native ? amount : 0n);
      const sent = await signAndMaybeSend(record, chainId, calls, { to: getAddress(recipient), asset: symbol, amount: amountText });
      if (!sent.hash || !sent.next) {
        setNote("Signed. Sending is not connected on this chain yet.");
        return;
      }
      await persist(sent.next);
      void appendActivity({
        id: sent.hash,
        chainId,
        kind: "send",
        hash: sent.hash,
        amount: amountText,
        asset: symbol,
        to: getAddress(recipient),
        toName: draft?.toName,
        time: Date.now(),
        status: "pending",
        nonce: chainState(sent.next, chainId).pendingSend?.nonce,
      }).catch(() => undefined);
      setNote("Sent. Waiting for the network.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send.";
      if (message.startsWith("Not enough ETH") || message.startsWith("The network fee could not be sized")) throw error;
      setNote(message);
    }
  }

  async function assertCanPayFee(source: VaultRecord, selected: number, calls: Call[], nativeSpend: bigint) {
    if (!source.account) return;
    const env = chainEnv(selected);
    if (!env.bundlerUrl || !env.rpcUrl) return;
    const chainName = getChain(selected)?.name;
    const state = chainState(source, selected);
    const draft = buildUserOp({
      sender: source.account,
      nonce: BigInt(state.generation),
      callData: executeAndRotateCalldata({
        calls,
        nextSigner: getAddress("0x0000000000000000000000000000000000000001"),
        nextKeyType: hotKeyTypeForChain(selected),
      }),
      keyType: state.keyType,
      initCode: initFor(source, selected, state.deployed),
    });
    let priced;
    try {
      priced = await quoteOperationGas({
        bundlerUrl: env.bundlerUrl,
        rpcUrl: env.rpcUrl,
        op: draft,
        calls,
        keyType: state.keyType,
        chainName,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Not enough ETH")) throw error;
      return;
    }
    const native = await readNativeBalance(selected, source.account);
    if (native < nativeSpend + priced.networkFeeWei) {
      throw new Error(explainBundlerError("AA21", chainName));
    }
  }

  async function submitCalls(calls: Call[], meta?: { kind: "swap" | "bridge"; amount?: string; asset?: string; to?: string }): Promise<string> {
    if (!record?.account) throw new Error("Locked.");
    const sent = await signAndMaybeSend(record, chainId, calls);
    if (!sent.hash || !sent.next) throw new Error("Sending is not connected on this chain yet.");
    await persist(sent.next);
    if (meta) {
      await appendActivity({
        id: sent.hash,
        chainId,
        kind: meta.kind,
        hash: sent.hash,
        amount: meta.amount,
        asset: meta.asset,
        to: meta.to,
        time: Date.now(),
        status: "pending",
        nonce: chainState(sent.next, chainId).pendingSend?.nonce,
      });
    }
    return sent.hash;
  }

  async function replacePending(kind: PendingSend["kind"], selectedChain = chainId) {
    if (!record?.account) return;
    const adopted = await adoptIncludedKeys(record);
    if (adopted !== record) await persist(adopted);
    if (!adopted.account) return;
    const hadPending = Boolean(chainState(record, selectedChain).pendingSend);
    const state = chainState(adopted, selectedChain);
    const pending = state.pendingSend;
    if (!pending) {
      setNote(hadPending ? "This chain switched keys. Other chains switch on their own." : "Nothing is waiting on this chain.");
      return;
    }
    try {
      await assertHoldsKey(adopted, selectedChain);
      const callData =
        kind === "send"
          ? pending.callData
          : executeAndRotateCalldata({ calls: [], nextSigner: pending.nextSigner, nextKeyType: pending.nextKeyType });
      let initCode = pending.initCode;
      if (initCode !== "0x") {
        const facts = await readAccountFacts(selectedChain, adopted.account);
        if (facts.deployed) initCode = "0x";
      }
      const env = chainEnv(selectedChain);
      if (!env.bundlerUrl) {
        setNote("Sending is not connected on this chain yet.");
        return;
      }
      const chainName = getChain(selectedChain)?.name;
      let floor = { maxPriorityFeePerGas: 0n, maxFeePerGas: 0n };
      if (env.rpcUrl) {
        try {
          floor = await feeQuote({ bundlerUrl: env.bundlerUrl, rpcUrl: env.rpcUrl });
        } catch {
          floor = { maxPriorityFeePerGas: 0n, maxFeePerGas: 0n };
        }
      }
      const bumpedPriority = (BigInt(pending.maxPriorityFeePerGas) * 12n) / 10n + 1n;
      const bumpedMax = (BigInt(pending.maxFeePerGas) * 12n) / 10n + 1n;
      let maxFeePerGas = bumpedMax > floor.maxFeePerGas ? bumpedMax : floor.maxFeePerGas;
      const maxPriorityFeePerGas = bumpedPriority > floor.maxPriorityFeePerGas ? bumpedPriority : floor.maxPriorityFeePerGas;
      if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;
      const decodedCalls = decodeExecuteCalls(callData);
      const replacementGas = {
        verificationGasLimit: BigInt(pending.verificationGasLimit),
        callGasLimit: await flooredCallGas(env.rpcUrl, adopted.account, callData, BigInt(pending.callGasLimit)),
        preVerificationGas: BigInt(pending.preVerificationGas),
        maxPriorityFeePerGas,
        maxFeePerGas,
      };
      assertCallGas(replacementGas, decodedCalls ?? [{ target: adopted.account, value: 0n, data: "0x" }]);
      const draft = buildUserOp({
        sender: adopted.account,
        nonce: BigInt(pending.nonce),
        callData,
        initCode,
        keyType: state.keyType,
        gas: replacementGas,
      });
      const signature = await signCurrent(userOpHash(draft, BigInt(selectedChain)), selectedChain, adopted);
      const op = { ...draft, signature };
      const sent = await submitPriced({
        bundlerUrl: env.bundlerUrl,
        op,
        chainName,
        resign: async (gas) => {
          const next = buildUserOp({
            sender: adopted.account!,
            nonce: BigInt(pending.nonce),
            callData,
            initCode,
            keyType: state.keyType,
            gas,
          });
          return { ...next, signature: await signCurrent(userOpHash(next, BigInt(selectedChain)), selectedChain, adopted) };
        },
      });
      await persist(rememberSend(adopted, selectedChain, sent.op, sent.hash, pending.nextSigner, pending.nextKeyType, kind, {
        to: pending.to,
        asset: pending.asset,
        amount: pending.amount,
      }));
      void markActivity(pending.userOpHash, kind === "cancel" ? "cancelled" : "replaced").catch(() => undefined);
      void appendActivity({
        id: sent.hash,
        chainId: selectedChain,
        kind: kind === "cancel" ? "cancel" : "speed",
        hash: sent.hash,
        amount: pending.amount,
        asset: pending.asset,
        to: pending.to,
        time: Date.now(),
        status: "pending",
        nonce: pending.nonce,
      }).catch(() => undefined);
      setNote(kind === "send" ? "Fee raised. The old key stays until this lands." : "Cancel sent. The old key stays until this lands.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not replace the send.";
      setNote(message);
    }
  }

  async function checkStatus() {
    if (!record?.account) return;
    const pending = chainState(record, chainId).pendingSend;
    if (!pending) {
      setNote("Nothing is waiting on this chain.");
      return;
    }
    const refreshNote = await refresh(record);
    if (refreshNote) return;
    setNote("Still waiting. The old key can still spend until this lands.");
  }

  async function loadBalances(account: Address) {
    const rows: Holding[] = [];
    for (const item of CHAINS) {
      try {
        const amount = await readNativeBalance(item.chainId, account);
        rows.push({
          key: `${item.chainId}:ETH`,
          chainId: item.chainId,
          chainName: item.name,
          symbol: "ETH",
          amount,
          decimals: 18,
          text: formatUnits(amount, 18),
          native: true,
          unavailable: false,
        });
      } catch {
        rows.push({
          key: `${item.chainId}:ETH`,
          chainId: item.chainId,
          chainName: item.name,
          symbol: "ETH",
          amount: 0n,
          decimals: 18,
          text: "—",
          native: true,
          unavailable: true,
        });
      }
      if (item.chainId === 1 || item.chainId === 8453) {
        try {
          for (const token of await readBalances(item.chainId, account)) {
            if (token.symbol === "ETH") continue;
            rows.push({
              key: `${item.chainId}:${token.symbol}`,
              chainId: item.chainId,
              chainName: item.name,
              symbol: token.symbol,
              amount: token.amount,
              decimals: token.decimals,
              text: token.text,
              native: token.native,
              unavailable: token.unavailable,
            });
          }
        } catch {
          // Native rows already say when a chain cannot be read.
        }
      }
    }
    setBalances(rows);
    setBalancesReady(true);
  }

  async function pair(nextUri?: string) {
    if (pairBusy) return;
    const id = WALLETCONNECT_PROJECT_ID.trim();
    const code = (nextUri ?? uri).trim();
    if (!id) {
      setPairMessage("Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in apps/mobile/.env and restart the app.");
      return;
    }
    if (!code.startsWith("wc:")) {
      setPairMessage("Scan the site's connection code.");
      return;
    }
    if (!record?.account) return;
    setPairBusy(true);
    setPairMessage("Connecting.");
    try {
      const linked = await pairWalletConnect({
        projectId: id,
        uri: code,
        account: record.account,
        chainId,
        approveSite: askSite,
        confirm: (decision) => ask(decision),
        signMessage: (message, selected) =>
          signPersonal({
            account: record.account as Address,
            chainId: selected,
            message,
            signCurrent: (digest) => signCurrent(digest, selected, record),
          }),
        signTypedData: (typedDataJson, selected) =>
          signTypedData({
            account: record.account as Address,
            chainId: selected,
            typedDataJson,
            signCurrent: (digest) => signCurrent(digest, selected, record),
          }),
        sendCalls: async (calls, selected) => {
          const sent = await signAndMaybeSend(record, selected, calls);
          if (!sent.hash || !sent.next) throw new Error("Sending is not connected on this chain yet.");
          await persist(sent.next);
          return sent.hash as Hex;
        },
        switchChain: async (selected) => {
          const next = { ...record, selectedChainId: selected };
          await persist(next);
          await refresh(next);
        },
      });
      setSession(linked);
      const saved = await rememberSite({
        topic: linked.topic,
        name: linked.name,
        url: linked.url,
        icon: linked.icon,
        connectedAt: Date.now(),
      });
      setSites(saved);
      const connected = "Connected. The site sees your address only.";
      setPairMessage(connected);
      setNote(connected);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not connect.";
      setPairMessage(message);
      setNote(message);
    } finally {
      setPairBusy(false);
    }
  }

  async function chooseChain(selected: number) {
    if (!record) return;
    const next = { ...record, selectedChainId: selected };
    await persist(next);
    await refresh(next);
  }

  function freshRecord(account: Address, recovery: Address): VaultRecord {
    return (
      record ?? {
        v: 3,
        accountIndex: 0,
        account,
        recovery,
        originalRecovery: recovery,
        recoveryEpoch: "0",
        selectedChainId: chainId,
        chains: Object.fromEntries(CHAINS.map((item) => [String(item.chainId), emptyChainState()])),
      }
    );
  }

  async function buildLook() {
    try {
      if (!mnemonic.trim()) {
        setNote("Enter the 24 words.");
        return;
      }
      if (!password) {
        setNote("Choose a phone password.");
        return;
      }
      const creation = deriveRecovery(mnemonic, 0, 0);
      const predicted = predictAccount(creation.address);
      if (record?.account && getAddress(record.account) !== getAddress(predicted)) {
        setNote("These words do not match this wallet.");
        return;
      }
      const derived = await chainsFromWords(mnemonic, predicted);
      let next = freshRecord(predicted, creation.address);
      next = { ...next, account: predicted, originalRecovery: creation.address };
      for (const item of CHAINS) {
        const existing = chainState(next, item.chainId);
        const added = derived[String(item.chainId)];
        next = withChainState(next, item.chainId, {
          ...existing,
          initialSigner: added.initialSigner,
          initialKey: existing.hotKeyId ? null : added.initialKey,
          activationSignature: existing.hotKeyId ? null : added.activationSignature,
        });
      }
      const views = await scanChains(next);
      for (const view of views) {
        if (!view.checked || !view.deployed || view.initialHotLive) continue;
        const state = chainState(next, view.chainId);
        if (state.hotKeyId) continue;
        next = withChainState(next, view.chainId, {
          ...state,
          initialKey: null,
          activationSignature: null,
        });
      }
      await persist(next);
      setMnemonic("");
      setCutoff(null);
      setScreen("home");
      const refreshNote = await refresh(next);
      if (!refreshNote) {
        setNote("You can look, and you can receive. This does not cut off the old phone. Recovery does.");
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not read this wallet.");
    }
  }

  async function openFundedChain(
    source: VaultRecord,
    selected: number,
    recoveryKey: Hex,
    recovery: Address,
    keyType: KeyType,
  ): Promise<{ record: VaultRecord } | null> {
    if (!source.account) return null;
    if (chainState(source, selected).pendingSend) return { record: source };
    const env = chainEnv(selected);
    if (!env.bundlerUrl || !env.rpcUrl) return null;
    let native = 0n;
    try {
      native = await readNativeBalance(selected, source.account);
    } catch {
      return null;
    }
    if (native === 0n) return null;
    try {
      const initial = await keys.keystore.create(keyType === 2 ? "p256" : "secp256k1");
      let nextKeyId: string;
      let nextSigner: Address;
      let nextKeyType: KeyType;
      try {
        const prepared = await wal.requirePrepared(source.account, selected, 0n);
        nextKeyId = prepared.nextKeyId;
        nextSigner = prepared.nextSigner;
        nextKeyType = prepared.nextKeyType;
      } catch (error) {
        const missing = error instanceof Error && error.message.includes("Write-ahead");
        if (!missing) throw error;
        const created = await prepareRotation({
          account: source.account,
          chainId: selected,
          generation: 0n,
          keystore: keys.keystore,
          wal,
          keyType,
        });
        nextKeyId = created.id;
        nextSigner = created.signer;
        nextKeyType = created.keyType;
      }
      const signature = await signSecp256k1(
        recoveryKey,
        activationDigest({
          account: source.account,
          chainId: BigInt(selected),
          initialSigner: initial.signer,
          keyType,
        }),
      );
      const draft = firstUseDraft({
        account: source.account,
        chainId: BigInt(selected),
        recovery,
        initialSigner: initial.signer,
        initialKeyType: keyType,
        activationSignature: signature,
        nextSigner,
        nextKeyType,
      });
      const chainName = getChain(selected)?.name;
      const quoted = await quoteOperationGas({
        bundlerUrl: env.bundlerUrl,
        rpcUrl: env.rpcUrl,
        op: draft,
        calls: [],
        keyType,
        chainName,
      });
      if (native < quoted.networkFeeWei) return null;
      const op = {
        ...quoted.op,
        signature: await keys.keystore.sign(initial.id, userOpHash(quoted.op, BigInt(selected))),
      };
      const sent = await submitPriced({
        bundlerUrl: env.bundlerUrl,
        op,
        chainName,
        resign: async (gas) => {
          const next = buildUserOp({
            sender: quoted.op.sender,
            nonce: quoted.op.nonce,
            callData: quoted.op.callData,
            initCode: quoted.op.initCode,
            keyType,
            gas,
          });
          return { ...next, signature: await keys.keystore.sign(initial.id, userOpHash(next, BigInt(selected))) };
        },
      });
      let next = withChainState(source, selected, {
        ...chainState(source, selected),
        hotKeyId: initial.id,
        keyType,
        currentSigner: initial.signer,
        deployed: false,
        pendingHotKeyId: nextKeyId,
        pendingSigner: nextSigner,
        pendingKeyType: nextKeyType,
        recoveryQueue: [
          { id: initial.id, signer: initial.signer, keyType },
          { id: nextKeyId, signer: nextSigner, keyType: nextKeyType },
        ],
        initialKey: null,
        activationSignature: null,
      });
      next = rememberSend(next, selected, sent.op, sent.hash, nextSigner, nextKeyType, "send");
      return { record: next };
    } catch {
      return null;
    }
  }

  function beginSitting(): { next: VaultRecord; creation: ReturnType<typeof deriveRecovery> } | null {
    if (!mnemonic.trim()) {
      setNote("Enter the 24 words.");
      return null;
    }
    if (!password) {
      setNote("Choose a phone password.");
      return null;
    }
    const creation = deriveRecovery(mnemonic, 0, 0);
    const predicted = predictAccount(creation.address);
    if (record?.account && getAddress(record.account) !== getAddress(predicted)) {
      setNote("These words do not match this wallet.");
      return null;
    }
    const next = { ...freshRecord(predicted, creation.address), account: predicted, originalRecovery: creation.address };
    return { next, creation };
  }

  async function prepareOutsideClose(
    source: VaultRecord,
    selected: number,
    recoveryKey: Hex,
    recovery: Address,
    keyType: KeyType,
  ): Promise<{ record: VaultRecord; call: string }> {
    if (!source.account) throw new Error("The address is not ready.");
    const state = chainState(source, selected);
    let signer = state.pendingSigner;
    let id = state.pendingHotKeyId;
    let pendingType = state.pendingKeyType ?? keyType;
    if (!signer || !id) {
      const created = await keys.keystore.create(keyType === 2 ? "p256" : "secp256k1");
      signer = created.signer;
      id = created.id;
      pendingType = keyType;
    }
    const signature = await signSecp256k1(
      recoveryKey,
      activationDigest({
        account: source.account,
        chainId: BigInt(selected),
        initialSigner: signer,
        keyType: pendingType,
      }),
    );
    const call = encodeFunctionData({
      abi: factoryAbi,
      functionName: "createAccount",
      args: [recovery, 0n, { initialSigner: signer, keyType: pendingType, signature }],
    });
    const record = withChainState(source, selected, {
      ...state,
      pendingHotKeyId: id,
      pendingSigner: signer,
      pendingKeyType: pendingType,
      recoveryQueue: [{ id, signer, keyType: pendingType }],
      initialKey: null,
      activationSignature: null,
    });
    return { record, call };
  }

  async function buildRecover() {
    try {
      const sitting = beginSitting();
      if (!sitting) return;
      let next = sitting.next;
      const { creation } = sitting;
      const views = await scanChains(next);
      const target = cutoffTarget(views, BigInt(next.recoveryEpoch || "0"));
      const rows: CutoffRow[] = [];
      for (const view of views) {
        const action = classifyChainCutoff(view, target);
        if ((action === "recover-one-step" || action === "one-step-of-longer-gap") && view.recoveryEpoch !== null && next.account) {
          const facts = await readAccountFacts(view.chainId, next.account);
          const steps = recoverySteps(view.recoveryEpoch, target);
          if (!facts.deployed || facts.recoveryEpoch !== view.recoveryEpoch || steps.length === 0) {
            rows.push({ chainId: view.chainId, name: view.name, action, deployed: true, result: "This chain changed. Try again." });
            continue;
          }
          const keyType = hotKeyTypeForChain(view.chainId);
          const deadline = BigInt(Math.floor(Date.now() / 1000) + ONE_DAY);
          let nonce = facts.authorityNonce;
          const calls: string[] = [];
          const queue: PreparedKey[] = [];
          for (const epoch of steps) {
            const created = await keys.keystore.create(keyType === 2 ? "p256" : "secp256k1");
            queue.push({ id: created.id, signer: created.signer, keyType });
            const request = buildRecoveryRequest({
              account: next.account,
              chainId: BigInt(view.chainId),
              newHotSigner: created.signer,
              newHotKeyType: keyType,
              nextRecoveryAuthority: deriveRecovery(mnemonic, 0, Number(epoch) + 1).address,
              recoveryEpoch: epoch,
              authorityNonce: nonce,
              deadline,
              mnemonicClient: true,
            });
            const signature = await signSecp256k1(deriveRecovery(mnemonic, 0, Number(epoch)).privateKey, recoveryDigest(request));
            calls.push(encodeFunctionData({ abi: accountAbi, functionName: "recover", args: [request, signature] }));
            nonce += 1n;
          }
          const state = chainState(next, view.chainId);
          next = withChainState(next, view.chainId, {
            ...state,
            pendingHotKeyId: queue[0].id,
            pendingSigner: queue[0].signer,
            pendingKeyType: keyType,
            recoveryQueue: queue,
          });
          rows.push({ chainId: view.chainId, name: view.name, action, deployed: true, calls });
          continue;
        }
        if (action === "deploy-and-retire" && next.account) {
          const keyType = hotKeyTypeForChain(view.chainId);
          const opened = await openFundedChain(next, view.chainId, creation.privateKey, creation.address, keyType);
          if (opened) {
            next = opened.record;
            rows.push({ chainId: view.chainId, name: view.name, action, deployed: false, submitted: true });
            continue;
          }
          rows.push({ chainId: view.chainId, name: view.name, action, deployed: false, stillOpen: true });
          continue;
        }
        rows.push({ chainId: view.chainId, name: view.name, action, deployed: view.deployed });
      }
      await persist(next);
      setCutoffKind("spend");
      setCutoff(rows);
      setNote("Done clears the words. They are not saved.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not prepare these chains.");
    }
  }

  async function buildSecureAll() {
    try {
      const sitting = beginSitting();
      if (!sitting) return;
      let next = sitting.next;
      const { creation } = sitting;
      const views = await scanChains(next);
      const rows: CutoffRow[] = [];
      for (const view of views) {
        if (!view.checked || !next.account) {
          rows.push({
            chainId: view.chainId,
            name: view.name,
            action: "not-checked",
            deployed: false,
            secureStatus: "not-checked",
          });
          continue;
        }
        const state = chainState(next, view.chainId);
        const alreadyThisPhone = Boolean(state.pendingSend) || (view.deployed && view.canSpend === true);
        let native = 0n;
        let tokens = { holdsTokens: false, known: true };
        if (!view.deployed && !alreadyThisPhone) {
          try {
            native = await readNativeBalance(view.chainId, next.account);
            tokens = await readHoldsListedTokens(view.chainId, next.account);
          } catch {
            rows.push({
              chainId: view.chainId,
              name: view.name,
              action: "deploy-and-retire",
              deployed: false,
              secureStatus: "not-checked",
            });
            continue;
          }
        }
        const classified = classifySecureNetwork({
          checked: true,
          deployed: view.deployed,
          secured: alreadyThisPhone,
          nativeBalance: native,
          holdsTokens: tokens.holdsTokens,
          tokensKnown: tokens.known,
        });
        const keyType = hotKeyTypeForChain(view.chainId);
        if (classified.status === "self-funded") {
          const opened = await openFundedChain(next, view.chainId, creation.privateKey, creation.address, keyType);
          if (opened) {
            next = opened.record;
            rows.push({
              chainId: view.chainId,
              name: view.name,
              action: "deploy-and-retire",
              deployed: false,
              submitted: true,
              secureStatus: "self-funded",
            });
            continue;
          }
        }
        if (classified.status === "self-funded" || classified.status === "needs-outside-payer") {
          const prepared = await prepareOutsideClose(next, view.chainId, creation.privateKey, creation.address, keyType);
          next = prepared.record;
          rows.push({
            chainId: view.chainId,
            name: view.name,
            action: "deploy-and-retire",
            deployed: false,
            calls: [prepared.call],
            secureStatus: "needs-outside-payer",
            secureReason: classified.reason ?? (native > 0n ? undefined : "empty"),
          });
          continue;
        }
        rows.push({
          chainId: view.chainId,
          name: view.name,
          action: view.deployed ? "already-here" : "not-checked",
          deployed: view.deployed,
          secureStatus: classified.status,
          awaitingSwitch: view.deployed && !alreadyThisPhone,
        });
      }
      await persist(next);
      setCutoffKind("secure");
      setCutoff(rows);
      setNote("Done clears the words. They are not saved.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not prepare these chains.");
    }
  }

  function leaveWords(next: Screen = record ? "security" : "create") {
    setMnemonic("");
    setCutoff(null);
    setCutoffKind("spend");
    setScreen(next);
  }

  function finishSitting() {
    setMnemonic("");
    setCutoff(null);
    setCutoffKind("spend");
    setScreen("home");
    setNote("Words cleared. The other phone can still spend until each chain lands.");
  }

  async function disconnectSite(topic: string) {
    if (session?.topic === topic) {
      try {
        await session.disconnect();
      } catch {
        setNote("Removed on this phone.");
      }
      setSession(null);
    }
    setSites(await forgetSite(topic));
  }

  async function confirmPassword(value: string): Promise<boolean> {
    if (heldPassword.current && value === heldPassword.current) return true;
    const raw = await SecureStore.getItemAsync(VAULT_KEY);
    if (!raw || !value) return false;
    try {
      const opened = await openUtf8Async(value, JSON.parse(raw));
      heldKey.current = opened.held;
      heldPassword.current = value;
      passwordRef.current = value;
      setPassword(value);
      return true;
    } catch {
      return false;
    }
  }

  async function enableBiometric(): Promise<void> {
    if (!heldKey.current) throw new Error("Unlock this phone first.");
    await saveBioKey(heldKey.current);
    setBioOn(true);
  }

  async function disableBiometric(): Promise<void> {
    await clearBioKey();
    setBioOn(false);
  }

  async function unlockWithBiometric(): Promise<void> {
    if (unlocking.current) return;
    unlocking.current = true;
    setUnlockBusy(true);
    setUnlockError(false);
    setUnlockMessage("");
    let held: VaultKey;
    try {
      held = await readBioKey();
    } catch (error) {
      unlocking.current = false;
      setUnlockBusy(false);
      if (isBioCancel(error)) {
        setUnlockError(false);
        setUnlockMessage("");
        return;
      }
      setUnlockError(true);
      setUnlockMessage(await bioFailureMessage());
      return;
    }
    try {
      const raw = await SecureStore.getItemAsync(VAULT_KEY);
      if (!raw) throw new Error("No wallet on this phone yet.");
      const text = openWithHeldKey(raw, held);
      const next = migrateVaultRecord(JSON.parse(text));
      heldKey.current = held;
      heldPassword.current = "";
      passwordRef.current = "";
      setPassword("");
      setRecord(next);
      setUnlockMessage("");
      setScreen("home");
      if (next.account) await refresh(next);
    } catch (error) {
      setUnlockError(true);
      setUnlockMessage(error instanceof Error ? error.message : "Could not unlock.");
    } finally {
      unlocking.current = false;
      setUnlockBusy(false);
    }
  }

  async function answerSiteRequest(input: { method: string; params?: unknown; origin: string }): Promise<unknown> {
    if (!record?.account) throw new Error("Unlock this phone first.");
    const method = input.method.trim();
    const params = Array.isArray(input.params) ? input.params : [];
    if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (method === "net_version") return String(chainId);
    if (method === "web3_clientVersion") return "KNOAD";
    if (method === "eth_accounts") return grantedOrigins.current.has(input.origin) ? [record.account] : [];
    if (SITE_READS.has(method)) return chainRpc(chainId, method, params);

    const decision = routeSessionRequest({
      method,
      params: input.params,
      account: record.account,
      chainId,
      origin: input.origin,
    });
    if (decision.kind === "reject") throw new Error(decision.reason);
    const accepted = await ask(decision);
    if (!accepted) throw new Error("Rejected");
    if (decision.kind === "accounts") {
      grantedOrigins.current.add(input.origin);
      setBrowserOrigins((current) => (current.includes(input.origin) ? current : [...current, input.origin]));
      return [decision.address];
    }
    if (decision.kind === "chain") return `0x${decision.chainId.toString(16)}`;
    if (decision.kind === "switch-chain") {
      const next = { ...record, selectedChainId: decision.chainId };
      await persist(next);
      await refresh(next);
      return null;
    }
    if (decision.kind === "sign-message") {
      return signPersonal({
        account: record.account,
        chainId: decision.chainId,
        message: decision.message,
        signCurrent: (digest) => signCurrent(digest, decision.chainId, record),
      });
    }
    if (decision.kind === "sign-typed-data") {
      return signTypedData({
        account: record.account,
        chainId: decision.chainId,
        typedDataJson: decision.typedDataJson,
        signCurrent: (digest) => signCurrent(digest, decision.chainId, record),
      });
    }
    const sent = await signAndMaybeSend(record, decision.chainId, decision.calls);
    if (!sent.hash || !sent.next) throw new Error("Sending is not connected on this chain yet.");
    await persist(sent.next);
    return sent.hash;
  }

  function revokeBrowser(origin: string) {
    grantedOrigins.current.delete(origin);
    setBrowserOrigins((current) => current.filter((item) => item !== origin));
  }

  async function changePassword(nextPassword: string): Promise<void> {
    if (!record || !heldKey.current) throw new Error("Unlock this phone first.");
    if (!nextPassword) throw new Error("Choose a password. It only unlocks this phone.");
    const held = await createVaultKey(nextPassword, VAULT_PARAMS);
    heldKey.current = held;
    heldPassword.current = nextPassword;
    passwordRef.current = nextPassword;
    setPassword(nextPassword);
    await persist(record, nextPassword);
    if (bioOn) await saveBioKey(held);
  }

  return {
    booted,
    hasVault,
    screen,
    setScreen,
    password,
    setPassword: updatePassword,
    createMessage,
    unlockMessage,
    unlockError,
    unlockBusy,
    showUnlock,
    showCreate,
    mnemonic,
    setMnemonic,
    checkIndex,
    checkWord,
    setCheckWord: updateCheckWord,
    backupMessage,
    backupError,
    backupBusy,
    record,
    note,
    setNote,
    balances,
    balancesReady,
    sites,
    bioOn,
    browserOrigins,
    revokeBrowser,
    disconnectSite,
    confirmPassword,
    enableBiometric,
    disableBiometric,
    unlockWithBiometric,
    changePassword,
    answerSiteRequest,
    pairMessage,
    pairBusy,
    to,
    setTo,
    uri,
    setUri,
    session,
    setSession,
    cutoff,
    cutoffKind,
    chainReport,
    prompt,
    answer,
    chain,
    chainId,
    current,
    canSpend,
    keyMode: keys.mode,
    submitCalls,
    startCreate,
    finishBackup,
    unlock,
    refresh,
    settleActivity,
    scanChains,
    send,
    pair,
    chooseChain,
    buildLook,
    buildRecover,
    buildSecureAll,
    leaveWords,
    finishSitting,
    speedUp: (onChain?: number) => replacePending("send", onChain),
    cancelSend: (onChain?: number) => replacePending("cancel", onChain),
    checkStatus,
  };
}
