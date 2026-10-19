import { useEffect, useRef, useState } from "react";
import { BackHandler, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { CHAINS, getChain, tokensForChain } from "@knoad/wallet-core";
import { activityForAccount, loadActivity, mergeActivity, pendingRows, type ActivityEntry } from "./src/activityLog";
import { readWalletNfts, type HeldNft } from "./src/nfts";
import { spendingKeyLine } from "./src/spendingKey";
import { bioFailureMessage, biometricPrompt, isBioCancel, readBioKey } from "./src/biometric";
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
import { BrowserDiscover, DappBrowser, TabSwitcher, type BrowserTabView, type DappBrowserHandle } from "./src/screens/BrowserScreen";
import { CreateScreen } from "./src/screens/CreateScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { NftScreen } from "./src/screens/NftScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { ReceiveScreen } from "./src/screens/ReceiveScreen";
import { RecoverScreen } from "./src/screens/RecoverScreen";
import { Scanner } from "./src/screens/Scanner";
import { SecurityScreen } from "./src/screens/SecurityScreen";
import { SendScreen } from "./src/screens/SendScreen";
import { AddWalletScreen, ImportWalletScreen } from "./src/screens/WalletSetupScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TradeScreen } from "./src/screens/TradeScreen";
import { UnlockScreen } from "./src/screens/UnlockScreen";

const AUTO_KEY = "knoad.activity.auto";
const TABS_KEY = "knoad.browser.tabs";

type Route =
  | { name: "tab"; tab: TabId }
  | { name: "send" }
  | { name: "receive" }
  | { name: "asset"; symbol: string }
  | { name: "nft"; token: HeldNft }
  | { name: "swap" }
  | { name: "browser" }
  | { name: "pair" }
  | { name: "addWallet" }
  | { name: "importKey" };

type Gate =
  | { kind: "send"; to: string; amount: string; symbol: string; fiat: string | null; toName?: string }
  | { kind: "speed" | "cancel"; chainId: number; summary: string }
  | { kind: "trade"; summary: string }
  | { kind: "nft"; nft: HeldNft; to: string };

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
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<Route>({ name: "tab", tab: "wallet" });
  const [tabs, setTabs] = useState<BrowserTabView[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabsReady, setTabsReady] = useState(false);
  const [tabSheet, setTabSheet] = useState(false);
  const forceNewTab = useRef(false);
  const tabsTouched = useRef(false);
  const tabSeq = useRef(0);
  function nextTabId() {
    tabSeq.current += 1;
    return `tab-${Date.now()}-${tabSeq.current}`;
  }
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
  const [nfts, setNfts] = useState<HeldNft[]>([]);
  const [nftStatus, setNftStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [nftTick, setNftTick] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [settingsNote, setSettingsNote] = useState("");

  const auth = ["create", "backup", "unlock", "recover"].includes(wallet.screen);
  const account = wallet.address ?? null;
  const visibleLog = account && wallet.mainAddress ? activityForAccount(log, account, wallet.mainAddress) : log;
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState("");
  const pairRef = useRef(wallet.pair);
  const setUriRef = useRef(wallet.setUri);
  const accountRef = useRef(account);
  const pendingCode = useRef<string | null>(null);
  const seenLink = useRef<string | null>(null);
  const browserRefs = useRef<Record<string, DappBrowserHandle | null>>({});
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
    if (!account) return;
    let live = true;
    setNftStatus("loading");
    void (async () => {
      const read = await readWalletNfts(account);
      if (!live) return;
      setNfts(read.nfts);
      setNftStatus(read.ok ? (read.nfts.length > 0 ? "ready" : "empty") : "error");
      if (read.activity.length > 0 && (await mergeActivity(read.activity)) && live) setLog(await loadActivity());
    })();
    return () => {
      live = false;
    };
  }, [account, nftTick]);

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
      if (walletsOpen) {
        setWalletsOpen(false);
        return true;
      }
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
      if (tabSheet) {
        setTabSheet(false);
        return true;
      }
      if (route.name === "browser") {
        if (activeTab && browserRefs.current[activeTab]?.goBack()) return true;
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
  }, [scan, bell, gate, route, wallet.screen, wallet.prompt, wallet.hasVault, tabSheet, activeTab, walletsOpen]);

  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(TABS_KEY).then((raw) => {
      if (!live) return;
      if (tabsTouched.current) {
        setTabsReady(true);
        return;
      }
      try {
        const parsed = raw ? (JSON.parse(raw) as { url?: string; title?: string }[]) : [];
        const next = parsed
          .filter((item) => typeof item.url === "string" && item.url.startsWith("http"))
          .slice(0, 6)
          .map((item) => ({ id: nextTabId(), url: item.url as string, title: item.title || host(item.url as string) }));
        if (next.length > 0) {
          setTabs(next);
          setActiveTab(next[0].id);
        }
      } catch {
        // A bad save leaves the list empty.
      }
      setTabsReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!tabsReady) return;
    void AsyncStorage.setItem(TABS_KEY, JSON.stringify(tabs.map(({ url, title }) => ({ url, title }))));
  }, [tabs, tabsReady]);

  useEffect(() => {
    if (route.name === "browser" && tabsReady && tabs.length === 0) setRoute({ name: "tab", tab: "browser" });
  }, [route.name, tabsReady, tabs.length]);

  if (!fontsLoaded || !wallet.booted) return <View style={styles.boot} />;

  function openSite(url: string) {
    tabsTouched.current = true;
    const fresh = forceNewTab.current;
    forceNewTab.current = false;
    if (!fresh) {
      const existing = tabs.find((tab) => host(tab.url) === host(url));
      if (existing) {
        setActiveTab(existing.id);
        setTabSheet(false);
        setRoute({ name: "browser" });
        return;
      }
    }
    let next = tabs;
    if (tabs.length >= 6) {
      const oldest = tabs.find((tab) => tab.id !== activeTab);
      next = oldest ? tabs.filter((tab) => tab.id !== oldest.id) : tabs.slice(0, -1);
    }
    const tab = { id: nextTabId(), url, title: host(url) };
    setTabs([...next, tab]);
    setActiveTab(tab.id);
    setTabSheet(false);
    setRoute({ name: "browser" });
  }

  function closeTab(id: string) {
    tabsTouched.current = true;
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (next.length === 0) {
      setActiveTab(null);
      setTabSheet(false);
      setRoute({ name: "tab", tab: "browser" });
      return;
    }
    if (id === activeTab) setActiveTab(next[Math.min(Math.max(index, 0), next.length - 1)].id);
  }

  function notePage(id: string, url: string, title: string) {
    setTabs((current) => {
      const tab = current.find((item) => item.id === id);
      if (!tab || (tab.url === url && tab.title === title)) return current;
      return current.map((item) => (item.id === id ? { ...item, url, title } : item));
    });
  }

  const tab: TabId = route.name === "tab" ? route.tab : route.name === "browser" ? "browser" : "wallet";
  const showBar = !auth && !gate && !wallet.prompt && route.name !== "browser" && route.name !== "receive" && route.name !== "asset" && route.name !== "nft" && route.name !== "swap" && route.name !== "pair" && route.name !== "addWallet" && route.name !== "importKey";
  const showHeader = !auth && route.name !== "browser" && (route.name === "tab" || Boolean(gate) || Boolean(wallet.prompt));
  const chainView = wallet.chainReport.find((view) => view.chainId === wallet.chainId);
  const selectedKeyLine = wallet.walletKind === "standard"
    ? "Standard wallet. This key does not change."
    : chainView?.checked
    ? `${chainView.name} · ${spendingKeyLine({
        deployed: chainView.deployed,
        pending: pendings.some((row) => row.chainId === wallet.chainId),
        generation: chainView.generation,
        signer: chainView.hotSigner,
        since: chainView.keySince,
      })}`
    : "";

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
    else if (gate.kind === "nft") {
      await wallet.transferNft(gate.nft, gate.to);
      setNftTick((value) => value + 1);
      setRoute({ name: "tab", tab: "activity" });
    } else {
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
          await readBioKey(biometricPrompt(draft?.action));
        } catch (error) {
          if (!isBioCancel(error)) setGateError(await bioFailureMessage("approve"));
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
      : gate?.kind === "nft"
        ? {
            assetName: gate.nft.collection,
            amount: `#${gate.nft.tokenId}`,
            toName: shortAddress(gate.to),
            toDetail: gate.to,
            chainId: gate.nft.chainId,
            network: getChain(gate.nft.chainId)?.name,
            action: `Send ${gate.nft.collection} #${gate.nft.tokenId}`,
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
        recent={visibleLog}
        standard={wallet.walletKind === "standard"}
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
  } else if (route.name === "nft") {
    body = (
      <NftScreen
        nft={route.token}
        onBack={() => setRoute({ name: "tab", tab: "wallet" })}
        canTransfer={wallet.walletKind === "knoad"}
        onTransfer={(to) => {
          setGateError("");
          setGate({ kind: "nft", nft: route.token, to });
        }}
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
    body = (
      <View style={[styles.browserWrap, { paddingBottom: insets.bottom }]}>
        {tabs.map((tab) => {
          const origin = host(tab.url);
          const site = wallet.sites.find((entry) => entry.url && host(entry.url) === origin);
          const visible = tab.id === activeTab;
          return (
            <View key={tab.id} pointerEvents={visible ? "auto" : "none"} style={visible ? styles.browserPane : styles.browserHidden}>
              <DappBrowser
                ref={(handle) => {
                  if (handle) browserRefs.current[tab.id] = handle;
                  else delete browserRefs.current[tab.id];
                }}
                url={tab.url}
                address={account ?? ""}
                connected={Boolean(site) || wallet.browserOrigins.includes(origin)}
                tabCount={tabs.length}
                message={wallet.pairBusy ? "Connecting to the site." : wallet.pairMessage}
                onBack={() => setRoute({ name: "tab", tab: "browser" })}
                onTabs={() => setTabSheet(true)}
                onPage={(url, title) => notePage(tab.id, url, title)}
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
            </View>
          );
        })}
        {gate || wallet.prompt ? (
          <ScrollView style={styles.approveOverlay} contentContainerStyle={styles.approveContent} keyboardShouldPersistTaps="handled">
            {approval}
          </ScrollView>
        ) : null}
        <TabSwitcher
          open={tabSheet}
          tabs={tabs}
          activeId={activeTab}
          onClose={() => setTabSheet(false)}
          onSelect={(id) => {
            setActiveTab(id);
            setTabSheet(false);
          }}
          onCloseTab={closeTab}
          onNew={() => {
            forceNewTab.current = true;
            setTabSheet(false);
            setRoute({ name: "tab", tab: "browser" });
          }}
        />
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
        log={visibleLog}
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
        scanning={wallet.walletKind !== "standard" && wallet.chainReport.length === 0}
        standard={wallet.walletKind === "standard"}
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
        openTabs={tabs.length}
        onOpenTabs={() => {
          forceNewTab.current = false;
          if (activeTab) setRoute({ name: "browser" });
        }}
        onOpen={openSite}
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
  } else if (route.name === "addWallet") {
    body = (
      <AddWalletScreen
        busy={setupBusy}
        message={setupMessage}
        onBack={() => setRoute({ name: "tab", tab: "wallet" })}
        onAdd={(name, words) => {
          setSetupBusy(true);
          setSetupMessage("");
          void wallet
            .addKnoadWallet(name, words)
            .then(() => setRoute({ name: "tab", tab: "wallet" }))
            .catch((error: unknown) => setSetupMessage(error instanceof Error ? error.message : "Could not add the wallet."))
            .finally(() => setSetupBusy(false));
        }}
      />
    );
  } else if (route.name === "importKey") {
    body = (
      <ImportWalletScreen
        busy={setupBusy}
        message={setupMessage}
        onBack={() => setRoute({ name: "tab", tab: "wallet" })}
        onImport={(name, privateKey) => {
          setSetupBusy(true);
          setSetupMessage("");
          void wallet
            .importStandardWallet(name, privateKey)
            .then(() => setRoute({ name: "tab", tab: "wallet" }))
            .catch((error: unknown) => setSetupMessage(error instanceof Error ? error.message : "Could not import the wallet."))
            .finally(() => setSetupBusy(false));
        }}
      />
    );
  } else if (account) {
    body = (
      <HomeScreen
        address={account}
        walletName={wallet.walletName}
        knoad={wallet.walletKind !== "standard"}
        chainId={wallet.chainId}
        holdings={wallet.balances}
        ready={wallet.balancesReady}
        securityTitle={wallet.walletKind === "standard" ? "Standard wallet" : securityTitle(chainView, pendings.some((row) => row.chainId === wallet.chainId))}
        keyLine={selectedKeyLine}
        onWallets={() => setWalletsOpen(true)}
        onChain={(chainId) => void wallet.chooseChain(chainId)}
        onSend={openSend}
        onReceive={() => setRoute({ name: "receive" })}
        onSwap={() => setRoute({ name: "swap" })}
        onSecurity={() => setRoute({ name: "tab", tab: "security" })}
        onAsset={(holding: Holding) => setRoute({ name: "asset", symbol: holding.symbol })}
        onOpenActivity={() => setRoute({ name: "tab", tab: "activity" })}
        log={visibleLog}
        nfts={nfts}
        nftStatus={nftStatus}
        onNft={(token) => setRoute({ name: "nft", token })}
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
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                void wallet.refresh();
                setNftTick((value) => value + 1);
              }}
              tintColor={theme.mint}
            />
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
      <Modal visible={walletsOpen} transparent animationType="fade" onRequestClose={() => setWalletsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setWalletsOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Wallets</Text>
            {wallet.wallets.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setWalletsOpen(false);
                  void wallet.selectWallet(item.id);
                }}
              >
                <Text style={styles.sheetRow}>{item.name}</Text>
                <Text style={styles.note}>{`${shortAddress(item.address)} · ${item.kind === "knoad" ? "KNOAD" : "Standard"}`}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setWalletsOpen(false);
                setSetupMessage("");
                setRoute({ name: "addWallet" });
              }}
            >
              <Text style={styles.sheetRow}>Add a KNOAD wallet</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setWalletsOpen(false);
                setSetupMessage("");
                setRoute({ name: "importKey" });
              }}
            >
              <Text style={styles.sheetRow}>Import a private key</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
    generation: "0",
    hotSigner: null,
    keySince: null,
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
  browserWrap: { flex: 1, position: "relative", backgroundColor: theme.bg },
  browserPane: { flex: 1 },
  browserHidden: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0 },
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
