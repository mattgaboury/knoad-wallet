import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";
import { browseTarget, hostOf, shortAddress } from "../format";
import { isWalletConnectLink, pairingCodeFromLink } from "../pairingLink";
import { PAGE_BRIDGE } from "../browserBridge";
import type { SavedSite } from "../sites";
import { theme } from "../theme";
import { GlowCard, GlowIcon, IconButton } from "../ui/chrome";
import { Icon } from "../ui/icons";

const BOOKMARKS = "knoad.browser.bookmarks";
const HISTORY = "knoad.browser.history";

export const FEATURED = [
  { name: "Uniswap", url: "https://app.uniswap.org", category: "DeFi", blurb: "Swap and provide liquidity." },
  { name: "OpenSea", url: "https://opensea.io", category: "NFTs", blurb: "Buy, sell, and discover NFTs." },
  { name: "Zapper", url: "https://zapper.xyz", category: "Portfolio", blurb: "Track a DeFi portfolio." },
  { name: "Base", url: "https://www.base.org", category: "Ecosystem", blurb: "Explore apps on Base." },
  { name: "CowSwap", url: "https://swap.cow.fi", category: "DEX", blurb: "Find rates across DEXs." },
  { name: "Aave", url: "https://app.aave.com", category: "Lending", blurb: "Lend and borrow onchain." },
];

type Mark = { url: string; title: string; at: number };

export function BrowserDiscover(props: {
  sites: SavedSite[];
  onOpen: (url: string) => void;
  onScan: () => void;
  onWalletConnect: (uri: string) => void;
  onSites: () => void;
}) {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<"discover" | "bookmarks" | "history">("discover");
  const [bookmarks, setBookmarks] = useState<Mark[]>([]);
  const [history, setHistory] = useState<Mark[]>([]);

  useEffect(() => {
    void AsyncStorage.getItem(BOOKMARKS).then((raw) => setBookmarks(raw ? (JSON.parse(raw) as Mark[]) : []));
    void AsyncStorage.getItem(HISTORY).then((raw) => setHistory(raw ? (JSON.parse(raw) as Mark[]) : []));
  }, []);

  function go(input: string) {
    const target = browseTarget(input);
    if (!target) return;
    if (target.startsWith("wc:")) {
      props.onWalletConnect(target);
      return;
    }
    props.onOpen(target);
  }

  const list = segment === "bookmarks" ? bookmarks : history;

  return (
    <View style={styles.wrap}>
      <View style={styles.search}>
        <Icon name="search" size={18} color={theme.mint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => go(query)}
          placeholder="Search or enter a URL"
          placeholderTextColor={theme.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        <Pressable onPress={props.onScan} accessibilityLabel="Scan">
          <Icon name="scan" size={18} color={theme.textMuted} />
        </Pressable>
      </View>
      <View style={styles.segments}>
        {(["discover", "bookmarks", "history"] as const).map((item) => (
          <Pressable key={item} onPress={() => setSegment(item)} style={[styles.segment, segment === item ? styles.segmentOn : null]}>
            <Text style={[styles.segmentText, segment === item ? styles.segmentTextOn : null]}>{item[0].toUpperCase() + item.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {segment === "discover" ? (
        <>
          <GlowCard>
            <View style={styles.protectBlock}>
              <View style={styles.protect}>
                <GlowIcon name="shieldCheck" />
                <Text style={styles.protectTitle} numberOfLines={1}>
                  Browse with KNOAD Protection
                </Text>
                <Text style={styles.active}>ACTIVE</Text>
              </View>
              <Text style={styles.body}>Sites never see your words or keys. Every request opens on this phone for your approval.</Text>
            </View>
          </GlowCard>
          {props.sites.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Connected Sites</Text>
                <Pressable onPress={props.onSites}>
                  <Text style={styles.link}>View All</Text>
                </Pressable>
              </View>
              <Text style={styles.body}>Manage dApps and websites connected to your wallet.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.siteRow}>
                {props.sites.map((site) => (
                  <Pressable key={site.topic} style={styles.siteTile} onPress={() => site.url && props.onOpen(site.url.startsWith("http") ? site.url : `https://${site.url}`)}>
                    <Favicon name={site.name} url={site.url} icon={site.icon} />
                    <Text style={styles.siteName} numberOfLines={1}>
                      {site.name}
                    </Text>
                    <Text style={styles.domain} numberOfLines={1}>
                      {hostOf(site.url)}
                    </Text>
                    <Text style={styles.connected}>Connected</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Featured dApps</Text>
            <View style={styles.grid}>
              {FEATURED.map((app) => (
                <Pressable key={app.url} style={styles.feature} onPress={() => props.onOpen(app.url)}>
                  <Favicon name={app.name} url={app.url} size={40} />
                  <View style={styles.featureCopy}>
                    <View style={styles.inline}>
                      <Text style={styles.siteName} numberOfLines={1}>
                        {app.name}
                      </Text>
                      <Text style={styles.category}>{app.category}</Text>
                    </View>
                    <Text style={styles.body} numberOfLines={1}>
                      {app.blurb}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={theme.textDim} />
                </Pressable>
              ))}
            </View>
          </View>
        </>
      ) : (
        <View style={styles.card}>
          {list.length === 0 ? <Text style={styles.body}>{segment === "bookmarks" ? "No bookmarks yet." : "No history yet."}</Text> : null}
          {list.map((item) => (
            <Pressable key={item.url} onPress={() => props.onOpen(item.url)} style={styles.historyRow}>
              <Text style={styles.siteName}>{item.title}</Text>
              <Text style={styles.domain}>{hostOf(item.url)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export type DappBrowserHandle = { goBack: () => boolean };

export const DappBrowser = forwardRef<
  DappBrowserHandle,
  {
    url: string;
    address: string;
    connected: boolean;
    message?: string;
    onBack: () => void;
    onWalletConnect: (uri: string) => void;
    onRpc: (input: { method: string; params?: unknown; origin: string }) => Promise<unknown>;
    onDisconnect: () => void;
    onClose: () => void;
  }
>(function DappBrowser(props, ref) {
  const [page, setPage] = useState(props.url);
  const [title, setTitle] = useState(hostOf(props.url));
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [toast, setToast] = useState("");
  const webRef = useRef<WebView>(null);
  const pageRef = useRef(props.url);
  const domain = hostOf(page);

  useImperativeHandle(
    ref,
    () => ({
      goBack() {
        if (!canBack) return false;
        webRef.current?.goBack();
        return true;
      },
    }),
    [canBack],
  );

  useEffect(() => {
    if (!props.message) {
      setToast("");
      return;
    }
    setToast(props.message);
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [props.message]);

  function onNav(state: WebViewNavigation) {
    pageRef.current = state.url;
    setPage(state.url);
    setTitle(state.title || hostOf(state.url));
    setCanBack(state.canGoBack);
    setCanForward(state.canGoForward);
    void rememberHistory(state.url, state.title || hostOf(state.url));
  }

  function reply(id: string, body: { ok: boolean; result?: unknown; error?: string; code?: number }) {
    const payload = JSON.stringify(body).replace(/</g, "\\u003c");
    webRef.current?.injectJavaScript(`window.__knoadDone(${JSON.stringify(id)}, ${payload});true;`);
  }

  function emit(event: string, payload: unknown) {
    const body = JSON.stringify(payload).replace(/</g, "\\u003c");
    webRef.current?.injectJavaScript(`window.__knoadEmit(${JSON.stringify(event)}, ${body});true;`);
  }

  async function onPageMessage(raw: string) {
    let message: { type?: string; url?: string; id?: string; method?: string; params?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === "wc" && message.url) {
      const uri = pairingCodeFromLink(message.url);
      if (uri) props.onWalletConnect(uri);
      return;
    }
    if (message.type !== "rpc" || !message.id || !message.method) return;
    const method = message.method;
    try {
      const result = await props.onRpc({ method, params: message.params, origin: hostOf(pageRef.current) });
      reply(message.id, { ok: true, result });
      if (method === "eth_requestAccounts" && Array.isArray(result)) emit("accountsChanged", result);
      if (method === "wallet_switchEthereumChain" && Array.isArray(message.params)) {
        const next = message.params[0] as { chainId?: string } | undefined;
        if (next?.chainId) emit("chainChanged", next.chainId);
      }
    } catch (error) {
      reply(message.id, { ok: false, error: error instanceof Error ? error.message : "Rejected", code: 4001 });
    }
  }

  function menu() {
    const actions: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [
      { text: "Forward", onPress: () => { if (canForward) webRef.current?.goForward(); } },
      { text: "Reload", onPress: () => webRef.current?.reload() },
      { text: "Bookmark", onPress: () => void toggleBookmark(page, title) },
      { text: "Share", onPress: () => void Share.share({ message: page }) },
      { text: "Open outside KNOAD", onPress: () => void Linking.openURL(page) },
    ];
    if (props.connected) {
      actions.push(
        { text: "Manage site", onPress: props.onClose },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            emit("accountsChanged", []);
            props.onDisconnect();
          },
        },
      );
    }
    actions.push({ text: "Close", style: "cancel" });
    Alert.alert(domain, props.connected ? shortAddress(props.address) : undefined, actions);
  }

  return (
    <View style={styles.browser}>
      <View style={styles.toolbar}>
        <IconButton name="chevronLeft" label="Back" onPress={() => (canBack ? webRef.current?.goBack() : props.onBack())} />
        <View style={styles.domainPill}>
          <Icon name="lock" size={14} color={theme.mint} />
          <Text style={styles.domainText} numberOfLines={1}>
            {domain}
          </Text>
          <View style={[styles.liveDot, { backgroundColor: props.connected ? theme.mint : theme.textDim }]} />
        </View>
        <IconButton name="more" label="Page menu" onPress={menu} />
      </View>
      {toast ? (
        <Pressable onPress={() => setToast("")} style={styles.toast}>
          <Text style={styles.toastText} numberOfLines={1}>
            {toast}
          </Text>
        </Pressable>
      ) : null}
      <WebView
        source={{ uri: props.url }}
        style={styles.web}
        onNavigationStateChange={onNav}
        ref={webRef}
        setSupportMultipleWindows={false}
        injectedJavaScriptBeforeContentLoaded={PAGE_BRIDGE}
        injectedJavaScript={PAGE_BRIDGE}
        onMessage={(event) => void onPageMessage(event.nativeEvent.data)}
        onShouldStartLoadWithRequest={(request) => {
          if (!isWalletConnectLink(request.url)) return true;
          const uri = pairingCodeFromLink(request.url);
          if (uri) props.onWalletConnect(uri);
          return false;
        }}
      />
    </View>
  );
});

async function rememberHistory(url: string, title: string) {
  if (!url.startsWith("http")) return;
  try {
    const raw = await AsyncStorage.getItem(HISTORY);
    const current = raw ? (JSON.parse(raw) as Mark[]) : [];
    const next = [{ url, title, at: Date.now() }, ...current.filter((item) => item.url !== url)].slice(0, 40);
    await AsyncStorage.setItem(HISTORY, JSON.stringify(next));
  } catch {
    // History is optional.
  }
}

export async function toggleBookmark(url: string, title: string): Promise<void> {
  const raw = await AsyncStorage.getItem(BOOKMARKS);
  const current = raw ? (JSON.parse(raw) as Mark[]) : [];
  const exists = current.some((item) => item.url === url);
  const next = exists ? current.filter((item) => item.url !== url) : [{ url, title, at: Date.now() }, ...current];
  await AsyncStorage.setItem(BOOKMARKS, JSON.stringify(next));
}

function Favicon(props: { name: string; url: string; icon?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const size = props.size ?? 36;
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (failed || !props.url) {
    return (
      <View style={[styles.mono, box]}>
        <Text style={styles.monoText}>{props.name.slice(0, 1).toUpperCase()}</Text>
      </View>
    );
  }
  const uri = props.icon || `https://www.google.com/s2/favicons?domain=${hostOf(props.url)}&sz=128`;
  return <Image source={{ uri }} style={[styles.favicon, box]} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  search: {
    height: 56,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.borderMint,
    backgroundColor: theme.card,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 8,
  },
  searchInput: { flex: 1, color: theme.text, fontFamily: theme.font.regular, fontSize: 15 },
  segments: { flexDirection: "row", backgroundColor: theme.card, borderRadius: 999, borderWidth: 1, borderColor: theme.border, padding: 4 },
  segment: { flex: 1, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  segmentOn: { borderWidth: 1, borderColor: theme.mint, backgroundColor: theme.mintTint },
  segmentText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  segmentTextOn: { color: theme.mint },
  protectBlock: { gap: 6 },
  protect: { flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1, gap: 4 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
  protectTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15, flex: 1 },
  active: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 10, letterSpacing: 0.6 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", justifyContent: "space-between" },
  link: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 13 },
  siteRow: { flexDirection: "row", gap: 8 },
  siteTile: { width: 92, gap: 4 },
  siteName: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15, flexShrink: 1 },
  domain: { color: theme.textDim, fontFamily: theme.font.regular, fontSize: 11 },
  connected: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 11 },
  grid: { gap: 8 },
  feature: {
    backgroundColor: theme.inset,
    borderRadius: theme.radius.md,
    padding: 12,
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  featureCopy: { flex: 1, minWidth: 0, gap: 2 },
  category: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 10 },
  historyRow: { gap: 2, paddingVertical: 6 },
  favicon: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.elevated },
  mono: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.elevated, alignItems: "center", justifyContent: "center" },
  monoText: { color: theme.mint, fontFamily: theme.font.bold },
  browser: { flex: 1 },
  toolbar: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  domainPill: {
    flex: 1,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
  },
  domainText: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 13, flex: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  toast: { paddingHorizontal: 14, paddingVertical: 6 },
  toastText: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13 },
  web: { flex: 1, backgroundColor: theme.bg },
});
