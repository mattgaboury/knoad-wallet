import { useEffect, useRef, useState } from "react";
import { BackHandler, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CHAINS, getChain, tokensForChain } from "@knoad/wallet-core";
import { loadActivity, pendingRows, type ActivityEntry } from "./src/activityLog";
import { bioFailureMessage, isBioCancel, readBioKey } from "./src/biometric";
import { shortAddress } from "./src/format";
import { pairingCodeFromLink } from "./src/pairingLink";
import { loadSpot, type Spot } from "./src/prices";
import { theme } from "./src/theme";
import { useCommerce } from "./src/useCommerce";
import { useWallet, type Holding } from "./src/useWallet";
import { AppHeader, Screen, TabBar, type TabId } from "./src/ui/chrome";
import { Icon } from "./src/ui/icons";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { ApproveScreen, type ApprovalDraft } from "./src/screens/ApproveScreen";
import { AssetScreen } from "./src/screens/AssetScreen";
import { BackupScreen } from "./src/screens/BackupScreen";
import { BrowserDiscover, DappBrowser, type DappBrowserHandle } from "./src/screens/BrowserScreen";
import { CreateScreen } from "./src/screens/CreateScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { ReceiveScreen } from "./src/screens/ReceiveScreen";
import { RecoverScreen } from "./src/screens/RecoverScreen";
import { Scanner } from "./src/screens/Scanner";
import { SecurityScreen } from "./src/screens/SecurityScreen";
import { SendScreen } from "./src/screens/SendScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TradeScreen } from "./src/screens/TradeScreen";
import { UnlockScreen } from "./src/screens/UnlockScreen";

const AUTO_KEY = "knoad.activity.auto";

type Route =
  | { name: "tab"; tab: TabId }
  | { name: "send" }
  | { name: "receive" }
  | { name: "asset"; symbol: string }
  | { name: "swap" }
  | { name: "browser"; url: string }
  | { name: "pair" };

type Gate =
  | { kind: "send"; to: string; amount: string; symbol: string; fiat: string | null; toName?: string }
  | { kind: "speed" | "cancel"; chainId: number; summary: string }
  | { kind: "trade"; summary: string };

export function App() {
  return (
    <SafeAreaProvider>
      <WalletApp />
    </SafeAreaProvider>
  );
}

function WalletApp() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const wallet = useWallet();
  const commerce = useCommerce({
    account: wallet.record?.account ?? null,
    chainId: wallet.chainId,
    generation: BigInt(wallet.current.generation || "0"),
    deployed: wallet.current.deployed,
    recovery: wallet.record?.originalRecovery ?? null,
    activation:
      wallet.current.initialSigner && wallet.current.activationSignature
        ? { signer: wallet.current.initialSigner, signature: wallet.current.activationSignature }
        : null,
    keyType: wallet.current.keyType,
    setNote: wallet.setNote,
    chooseChain: wallet.chooseChain,
    submitCalls: wallet.submitCalls,
  });
  const [route, setRoute] = useState<Route>({ name: "tab", tab: "wallet" });
  useEffect(() => {
    if (route.name === "swap") commerce.prepare();
  }, [route.name]);
  const [gate, setGate] = useState<Gate | null>(null);
  const [gateError, setGateError] = useState("");
  const approving = useRef(false);
  const [scan, setScan] = useState(false);
  const [bell, setBell] = useState(false);
  const [auto, setAuto] = useState(false);
  const [ready, setReady] = useState(false);
  const [log, setLog] = useState<ActivityEntry[]>([]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [settingsNote, setSettingsNote] = useState("");

  const auth = ["create", "backup", "unlock", "recover"].includes(wallet.screen);
  const account = wallet.record?.account ?? null;
  const pairRef = useRef(wallet.pair);
  const setUriRef = useRef(wallet.setUri);
  const accountRef = useRef(account);
  const pendingCode = useRef<string | null>(null);
  const seenLink = useRef<string | null>(null);
  const browserRef = useRef<DappBrowserHandle>(null);
  pairRef.current = wallet.pair;
  setUriRef.current = wallet.setUri;
  accountRef.current = account;
  const pendings = pendingRows(wallet.record);
  const pending = pendings.find((row) => row.chainId === wallet.chainId) ?? pendings[0] ?? null;
  const alert = pendings.length > 0 || ready || Boolean(wallet.prompt);

  useEffect(() => {
    if (pendingCode.current) return;
    if (wallet.screen === "home") setRoute((current) => (current.name === "tab" ? current : { name: "tab", tab: "wallet" }));
  }, [wallet.screen]);

  useEffect(() => {
    if (wallet.screen !== "home" || !account || !pendingCode.current) return;
    const code = pendingCode.current;
    pendingCode.current = null;
    setUriRef.current(code);
    void pairRef.current(code);
  }, [wallet.screen, account]);

  useEffect(() => {
    let live = true;
    function accept(url: string | null) {
      const code = url ? pairingCodeFromLink(url) : null;
      if (!code || seenLink.current === code) return;
      seenLink.current = code;
      setUriRef.current(code);
      if (accountRef.current) {
        void pairRef.current(code);
        return;
      }
      pendingCode.current = code;
    }
    void Linking.getInitialURL().then((url) => {
      if (live) accept(url);
    });
    const sub = Linking.addEventListener("url", (event) => accept(event.url));
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const scanKey = route.name === "tab" && (route.tab === "security" || route.tab === "wallet") ? route.tab : null;
  useEffect(() => {
    if (auth || !scanKey || !account) return;
    void wallet.scanChains();
  }, [auth, scanKey, account]);

  useEffect(() => {
    void AsyncStorage.getItem(AUTO_KEY).then((value) => setAuto(value === "1"));
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const entries = await loadActivity();
      if (!live) return;
      setLog(entries);
      const changed = await wallet.settleActivity();
      if (changed && live) setLog(await loadActivity());
    })();
    return () => {
      live = false;
    };
  }, [wallet.record, wallet.note]);

  useEffect(() => {
    void loadSpot().then(setSpot);
  }, [wallet.balances]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      const stale = pendingRows(wallet.record).some((row) => row.pending.sentAt && Date.now() - row.pending.sentAt > 15 * 60 * 1000);
      setReady(stale);
    }, 20_000);
    return () => clearInterval(timer);
  }, [auto, wallet.record]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (scan) {
        setScan(false);
        return true;
      }
      if (bell) {
        setBell(false);
        return true;
      }
      if (gate) {
        setGate(null);
        return true;
      }
      if (wallet.prompt) {
        wallet.answer(false);
        return true;
      }
      if (wallet.screen === "recover") {
        wallet.leaveWords();
        return true;
      }
      if (wallet.screen === "backup") return true;
      if (wallet.screen === "create" && wallet.hasVault) {
        wallet.showUnlock();
        return true;
      }
      if (route.name === "browser") {
        if (browserRef.current?.goBack()) return true;
        setRoute({ name: "tab", tab: "browser" });
        return true;
      }
      if (route.name !== "tab") {
        setRoute({ name: "tab", tab: "wallet" });
        return true;
      }
      if (route.tab !== "wallet") {
        setRoute({ name: "tab", tab: "wallet" });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [scan, bell, gate, route, wallet.screen, wallet.prompt, wallet.hasVault]);

  if (!fontsLoaded || !wallet.booted) return <View style={styles.boot} />;

  const tab: TabId = route.name === "tab" ? route.tab : route.name === "browser" ? "browser" : "wallet";
  const showBar = !auth && !gate && !wallet.prompt && route.name !== "browser" && route.name !== "receive" && route.name !== "asset" && route.name !== "swap" && route.name !== "pair";
  const showHeader = !auth && route.name !== "browser" && (route.name === "tab" || Boolean(gate) || Boolean(wallet.prompt));
  const chainView = wallet.chainReport.find((view) => view.chainId === wallet.chainId);

  async function runGate() {
    if (wallet.prompt) {
      wallet.answer(true);
      return;
    }
    if (!gate) return;
    if (gate.kind === "send") {
      await wallet.send({ to: gate.to, amount: gate.amount, symbol: gate.symbol, toName: gate.toName });
      setRoute({ name: "tab", tab: "activity" });
    } else if (gate.kind === "speed") await wallet.speedUp(gate.chainId);
    else if (gate.kind === "cancel") await wallet.cancelSend(gate.chainId);
    else {
      await commerce.confirm();
      setRoute({ name: "tab", tab: "activity" });
    }
    setGate(null);
  }

  async function approveBio() {
    if (approving.current) return;
    approving.current = true;
    setGateError("");
    try {
      if (wallet.bioOn) {
        try {
          await readBioKey();
        } catch (error) {
          if (!isBioCancel(error)) setGateError(await bioFailureMessage());
          return;
        }
      }
      await runGate();
    } catch (error) {
      setGateError(error instanceof Error ? error.message : "Could not approve.");
    } finally {
      approving.current = false;
    }
  }

  async function approvePassword(password: string) {
    setGateError("");
    const ok = await wallet.confirmPassword(password);
    if (!ok) {
      setGateError("Wrong password.");
      return;
    }
    try {
      await runGate();
    } catch (error) {
      setGateError(error instanceof Error ? error.message : "Could not approve.");
    }
  }

  function openSend() {
    setRoute({ name: "send" });
  }

  const draft: ApprovalDraft | undefined = wallet.prompt
    ? { action: wallet.prompt.summary, siteName: wallet.prompt.site?.name, siteUrl: wallet.prompt.site?.url }
    : gate?.kind === "send"
      ? {
          assetSymbol: gate.symbol,
          assetName: `${gate.symbol} (${wallet.chain.name})`,
          amount: `${gate.amount} ${gate.symbol}`,
          fiat: gate.fiat,
          toName: gate.toName ?? shortAddress(gate.to),
          toDetail: gate.to,
          chainId: wallet.chainId,
          network: wallet.chain.name,
          action: `Send ${gate.amount} ${gate.symbol}`,
        }
      : gate
        ? {
            chainId: gate.kind === "trade" ? wallet.chainId : gate.chainId,
            network: getChain(gate.kind === "trade" ? wallet.chainId : gate.chainId)?.name,
            action: gate.summary,
          }
        : undefined;

  const approval = (
    <ApproveScreen
      draft={draft}
      bio={wallet.bioOn}
      error={gateError}
      onBiometric={() => void approveBio()}
      onPassword={(password) => void approvePassword(password)}
      rejectLabel={wallet.prompt ? "Reject" : "Cancel"}
      onReject={() => {
        setGateError("");
        if (wallet.prompt) wallet.answer(false);
        else setGate(null);
      }}
    />
  );

  let body = null;
  if (wallet.screen === "create") {
    body = (
      <CreateScreen
        password={wallet.password}
        message={wallet.createMessage}
        hasVault={wallet.hasVault}
        onPassword={wallet.setPassword}
        onCreate={wallet.startCreate}
        onRecover={() => wallet.setScreen("recover")}
        onBack={wallet.showUnlock}
      />
    );
  } else if (wallet.screen === "backup") {
    body = (
      <BackupScreen
        mnemonic={wallet.mnemonic}
        checkIndex={wallet.checkIndex}
        checkWord={wallet.checkWord}
        message={wallet.backupMessage}
        error={wallet.backupError}
        busy={wallet.backupBusy}
        onCheckWord={wallet.setCheckWord}
        onConfirm={() => void wallet.finishBackup()}
      />
    );
  } else if (wallet.screen === "unlock") {
    body = (
      <UnlockScreen
        password={wallet.password}
        message={wallet.unlockMessage}
        error={wallet.unlockError}
        busy={wallet.unlockBusy}
        bio={wallet.bioOn}
        onPassword={wallet.setPassword}
        onUnlock={() => void wallet.unlock()}
        onBiometric={() => void wallet.unlockWithBiometric()}
        onCreate={wallet.showCreate}
      />
    );
  } else if (wallet.screen === "recover") {
    body = (
      <RecoverScreen
        mnemonic={wallet.mnemonic}
        password={wallet.password}
        rows={wallet.cutoff}
        kind={wallet.cutoffKind}
        onMnemonic={wallet.setMnemonic}
        onPassword={wallet.setPassword}
        onLook={() => void wallet.buildLook()}
        onReplace={() => void wallet.buildRecover()}
        onSecure={() => void wallet.buildSecureAll()}
        onDone={wallet.finishSitting}
        onBack={() => wallet.leaveWords(account ? "home" : "create")}
      />
    );
  } else if ((gate || wallet.prompt) && route.name !== "browser") {
    body = approval;
  } else if (route.name === "send" && account) {
    body = (
      <SendScreen
        chainId={wallet.chainId}
        chainName={wallet.chain.name}
        initialTo={wallet.to}
        holdings={wallet.balances}
        spot={spot}
        recent={log}
        onChain={(chainId) => void wallet.chooseChain(chainId)}
        onScan={() => setScan(true)}
        onBack={() => setRoute({ name: "tab", tab: "wallet" })}
        onReview={(next) => {
          setGateError("");
          setGate({ kind: "send", to: next.to, amount: next.amount, symbol: next.symbol, fiat: next.fiat, toName: next.toName });
        }}
      />
    );
  } else if (route.name === "receive" && account) {
    body = <ReceiveScreen address={account} chainName={wallet.chain.name} onBack={() => setRoute({ name: "tab", tab: "wallet" })} />;
  } else if (route.name === "asset") {
    body = (
      <AssetScreen
        symbol={route.symbol}
        rows={wallet.balances.filter((row) => row.symbol === route.symbol)}
        spot={spot}
        onSend={openSend}
        onReceive={() => setRoute({ name: "receive" })}
        onBack={() => setRoute({ name: "tab", tab: "wallet" })}
      />
    );
  } else if (route.name === "swap") {
    const sellTokens = tokensForChain(wallet.chainId);
    const buyTokens = [...tokensForChain(1), ...tokensForChain(8453)];
    const bridging = Boolean(commerce.sell && commerce.buy && commerce.sell.chainId !== commerce.buy.chainId);
    body = (
      <TradeScreen
        sellTokens={sellTokens}
        buyTokens={buyTokens}
        sell={commerce.sell}
        buy={commerce.buy}
        amount={commerce.amount}
        holdings={wallet.balances}
        chainId={wallet.chainId}
        chainName={wallet.chain.name}
        view={commerce.sheet}
        bridge={commerce.bridge}
        busy={commerce.busy}
        onAmount={commerce.setAmount}
        onSell={commerce.setSell}
        onBuy={commerce.setBuy}
        onFlip={commerce.flip}
        onQuote={() => void commerce.quote()}
        onConfirm={() => {
          setGateError("");
          setGate({ kind: "trade", summary: bridging ? "Bridge these tokens" : "Swap these tokens" });
        }}
        onBack={() => setRoute({ name: "tab", tab: "wallet" })}
      />
    );
  } else if (route.name === "browser") {
    const site = wallet.sites.find((entry) => entry.url && host(entry.url) === host(route.url));
    const origin = host(route.url);
    body = (
      <View style={styles.browserWrap}>
        <DappBrowser
          ref={browserRef}
          url={route.url}
          address={account ?? ""}
          connected={Boolean(site) || wallet.browserOrigins.includes(origin)}
          message={wallet.pairBusy ? "Connecting to the site." : wallet.pairMessage}
          onBack={() => setRoute({ name: "tab", tab: "browser" })}
          onWalletConnect={(uri) => {
            wallet.setUri(uri);
            void wallet.pair(uri);
          }}
          onRpc={(message) => wallet.answerSiteRequest(message)}
          onDisconnect={() => {
            if (site) void wallet.disconnectSite(site.topic);
            wallet.revokeBrowser(origin);
          }}
          onClose={() => setRoute({ name: "tab", tab: "security" })}
        />
        {gate || wallet.prompt ? (
          <ScrollView style={styles.approveOverlay} contentContainerStyle={styles.approveContent} keyboardShouldPersistTaps="handled">
            {approval}
          </ScrollView>
        ) : null}
      </View>
    );
  } else if (route.name === "pair") {
    body = (
      <PairScreen
        uri={wallet.uri}
        message={wallet.pairMessage}
        busy={wallet.pairBusy}
        onUri={wallet.setUri}
        paired={Boolean(wallet.session)}
        onPair={(uri) => void wallet.pair(uri)}
        onDisconnect={() => {
          if (wallet.session) void wallet.disconnectSite(wallet.session.topic);
        }}
        onBack={() => setRoute({ name: "tab", tab: "settings" })}
      />
    );
  } else if (route.name === "tab" && route.tab === "activity") {
    body = (
      <ActivityScreen
        pending={pending}
        log={log}
        auto={auto}
        onAuto={(next) => {
          setAuto(next);
          void AsyncStorage.setItem(AUTO_KEY, next ? "1" : "0");
        }}
        onSpeed={() => {
          if (!pending) return;
          setGate({ kind: "speed", chainId: pending.chainId, summary: "Replace this operation with a higher fee." });
        }}
        onCancel={() => {
          if (!pending) return;
          setGate({ kind: "cancel", chainId: pending.chainId, summary: "Replace this operation with an empty one. The transfer will not be sent." });
        }}
        onFix={(recommend) => {
          if (!pending) return;
          setGate({
            kind: recommend === "cancel" ? "cancel" : "speed",
            chainId: pending.chainId,
            summary: recommend === "cancel" ? "Replace this operation with an empty one." : "Replace this operation with a higher fee.",
          });
        }}
      />
    );
  } else if (route.name === "tab" && route.tab === "security") {
    body = (
      <SecurityScreen
        views={wallet.chainReport.length > 0 ? wallet.chainReport : CHAINS.map((chain) => blank(chain.chainId, chain.name))}
        scanning={wallet.chainReport.length === 0}
        pendingIds={pendings.map((row) => row.chainId)}
        sites={wallet.sites}
        onRecover={() => wallet.setScreen("recover")}
        onDisconnect={(topic) => void wallet.disconnectSite(topic)}
      />
    );
  } else if (route.name === "tab" && route.tab === "browser") {
    body = (
      <BrowserDiscover
        sites={wallet.sites}
        onOpen={(url) => setRoute({ name: "browser", url })}
        onScan={() => setScan(true)}
        onWalletConnect={(uri) => {
          wallet.setUri(uri);
          void wallet.pair(uri);
        }}
        onSites={() => setRoute({ name: "tab", tab: "security" })}
      />
    );
  } else if (route.name === "tab" && route.tab === "settings") {
    body = (
      <SettingsScreen
        bio={wallet.bioOn}
        auto={auto}
        onBio={(next) => {
          void (next ? wallet.enableBiometric() : wallet.disableBiometric()).catch((error: unknown) => {
            setSettingsNote(error instanceof Error ? error.message : "Could not update biometric unlock.");
          });
        }}
        onAuto={(next) => {
          setAuto(next);
          void AsyncStorage.setItem(AUTO_KEY, next ? "1" : "0");
        }}
        onPassword={async (next) => {
          await wallet.changePassword(next);
          setSettingsNote("Password saved on this phone.");
        }}
        onPair={() => setRoute({ name: "pair" })}
        onSites={() => setRoute({ name: "tab", tab: "security" })}
        message={settingsNote}
      />
    );
  } else if (account) {
    body = (
      <HomeScreen
        address={account}
        chainId={wallet.chainId}
        holdings={wallet.balances}
        ready={wallet.balancesReady}
        securityTitle={securityTitle(chainView, pendings.some((row) => row.chainId === wallet.chainId))}
        onChain={(chainId) => void wallet.chooseChain(chainId)}
        onSend={openSend}
        onReceive={() => setRoute({ name: "receive" })}
        onSwap={() => setRoute({ name: "swap" })}
        onSecurity={() => setRoute({ name: "tab", tab: "security" })}
        onAsset={(holding: Holding) => setRoute({ name: "asset", symbol: holding.symbol })}
        onOpenActivity={() => setRoute({ name: "tab", tab: "activity" })}
        log={log}
      />
    );
  }

  return (
    <View style={styles.boot}>
      <Screen
        scroll={route.name !== "browser"}
        bleed={route.name === "browser"}
        header={
          showHeader ? (
            <AppHeader onScan={() => setScan(true)} onBell={() => setBell(true)} alert={alert} />
          ) : undefined
        }
        footer={showBar ? <TabBar active={tab} onChange={(next) => setRoute({ name: "tab", tab: next })} /> : undefined}
        refresh={
          route.name === "tab" && route.tab === "wallet" ? (
            <RefreshControl refreshing={false} onRefresh={() => void wallet.refresh()} tintColor={theme.mint} />
          ) : undefined
        }
      >
        {wallet.note && !auth && !gate && route.name !== "browser" ? (
          <View style={styles.noteRow}>
            <Text style={[styles.note, styles.noteText]} numberOfLines={1}>
              {wallet.note}
            </Text>
            <Pressable onPress={() => wallet.setNote("")} hitSlop={8} accessibilityLabel="Dismiss note">
              <Icon name="close" size={16} color={theme.textMuted} />
            </Pressable>
          </View>
        ) : null}
        {body}
      </Screen>
      {scan ? (
        <Scanner
          onClose={() => setScan(false)}
          onAddress={(value) => {
            wallet.setTo(value);
            setScan(false);
            setRoute({ name: "send" });
          }}
          onWalletConnect={(uri) => {
            setScan(false);
            wallet.setUri(uri);
            void wallet.pair(uri);
          }}
        />
      ) : null}
      <Modal visible={bell} transparent animationType="fade" onRequestClose={() => setBell(false)}>
        <Pressable style={styles.backdrop} onPress={() => setBell(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Alerts</Text>
            {pendings.length === 0 && !ready && !wallet.prompt ? <Text style={styles.note}>Nothing is waiting.</Text> : null}
            {ready ? <Text style={styles.note}>A higher-fee replacement is ready. Open Activity to approve it.</Text> : null}
            {wallet.prompt ? <Text style={styles.note}>{wallet.prompt.summary}</Text> : null}
            {pendings.map((row) => (
              <Pressable
                key={`${row.chainId}-${row.pending.userOpHash}`}
                onPress={() => {
                  setBell(false);
                  setRoute({ name: "tab", tab: "activity" });
                }}
              >
                <Text style={styles.sheetRow}>{`${getChain(row.chainId)?.name ?? "Network"} · ${row.pending.asset ?? "operation"} waiting`}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function securityTitle(view: { checked: boolean; deployed: boolean; canSpend?: boolean; needsWords?: boolean } | undefined, pending: boolean): string {
  if (!view) return "Checking security";
  if (!view.checked) return "Unable to check";
  if (pending) return "Key change pending";
  if (view.needsWords || (view.deployed && view.canSpend === false)) return "Recovery required";
  if (!view.deployed) return "Ready to receive";
  return "Security active";
}

function blank(chainId: number, name: string) {
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

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: theme.bg },
  browserWrap: { flex: 1 },
  approveOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.bg,
    zIndex: 2,
  },
  approveContent: { paddingBottom: 28 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  noteText: { flex: 1 },
  note: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  sheetTitle: { color: theme.text, fontFamily: theme.font.bold, fontSize: 20 },
  sheetRow: { color: theme.text, fontFamily: theme.font.medium, fontSize: 15, paddingVertical: 6 },
});
