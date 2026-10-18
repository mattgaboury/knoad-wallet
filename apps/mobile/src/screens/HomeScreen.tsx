import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { CHAINS, formatUnits } from "@knoad/wallet-core";
import type { ActivityEntry } from "../activityLog";
import type { Holding } from "../useWallet";
import { ActivityRow } from "./ActivityScreen";
import { shortAddress, signedPercent, signedUsd, usd } from "../format";
import { loadHistory, loadSpot, portfolioSeries, type RangeKey, type Spot } from "../prices";
import { isTestnet, theme } from "../theme";
import { ActionTile, Identicon, Sparkline } from "../ui/bits";
import { Chip, GlowCard, GlowIcon, IconButton } from "../ui/chrome";
import { Icon } from "../ui/icons";
import { ChainMark, TokenMark } from "../ui/marks";

const RANGES: RangeKey[] = ["1D", "1W", "1M", "1Y"];

export function HomeScreen(props: {
  address: string;
  chainId: number;
  holdings: Holding[];
  ready: boolean;
  securityTitle: string;
  onChain: (chainId: number) => void;
  onSend: () => void;
  onReceive: () => void;
  onSwap: () => void;
  onSecurity: () => void;
  onAsset: (holding: Holding) => void;
  onOpenActivity: () => void;
  log: ActivityEntry[];
}) {
  const [range, setRange] = useState<RangeKey>("1D");
  const [spot, setSpot] = useState<Spot | null>(null);
  const [spotDown, setSpotDown] = useState(false);
  const [series, setSeries] = useState<number[] | null>(null);
  const [section, setSection] = useState<"assets" | "nfts" | "activity">("assets");
  const [chainOnly, setChainOnly] = useState(false);

  useEffect(() => {
    let live = true;
    void loadSpot().then((next) => {
      if (!live) return;
      setSpot(next);
      setSpotDown(!next || next.eth === null);
    });
    return () => {
      live = false;
    };
  }, [props.holdings]);

  const mainnet = useMemo(() => props.holdings.filter((row) => !isTestnet(row.chainId) && !row.unavailable), [props.holdings]);
  const ethAmount = mainnet.filter((row) => row.symbol === "ETH" || row.symbol === "WETH").reduce((sum, row) => sum + Number(formatUnits(row.amount, row.decimals)), 0);
  const usdcAmount = mainnet.filter((row) => row.symbol === "USDC").reduce((sum, row) => sum + Number(formatUnits(row.amount, row.decimals)), 0);

  useEffect(() => {
    let live = true;
    void loadHistory(range).then((history) => {
      if (!live) return;
      if (!history) {
        setSeries(null);
        return;
      }
      setSeries(portfolioSeries(ethAmount, usdcAmount, history.eth, history.usdc));
    });
    return () => {
      live = false;
    };
  }, [range, ethAmount, usdcAmount]);

  const total = spot?.eth === null || spot?.eth === undefined ? null : ethAmount * spot.eth + usdcAmount * (spot.usdc ?? 1);
  const delta = series && series.length > 1 ? series[series.length - 1] - series[0] : null;
  const percent = delta !== null && series && series[0] ? (delta / series[0]) * 100 : null;
  const rows = props.holdings.filter((row) => {
    if (row.unavailable || row.amount <= 0n) return false;
    if (chainOnly && row.chainId !== props.chainId) return false;
    return true;
  });

  async function copy() {
    await Clipboard.setStringAsync(props.address);
    void Haptics.selectionAsync().catch(() => undefined);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.identity}>
        <View style={styles.identityMain}>
          <Identicon seed={props.address} />
          <View>
            <Pressable style={styles.nameRow} onPress={props.onReceive} accessibilityLabel="Show wallet address">
              <Text style={styles.name}>Main Wallet</Text>
              <Icon name="chevronDown" size={16} color={theme.textMuted} />
            </Pressable>
            <Pressable onPress={() => void copy()} style={styles.addressRow} accessibilityLabel="Copy address">
              <Text style={styles.address}>{shortAddress(props.address)}</Text>
              <Icon name="copy" size={14} color={theme.textMuted} />
            </Pressable>
          </View>
        </View>
        <View style={styles.ranges}>
          {RANGES.map((item) => (
            <Pressable key={item} onPress={() => setRange(item)} style={[styles.range, item === range ? styles.rangeOn : null]}>
              <Text style={[styles.rangeText, item === range ? styles.rangeTextOn : null]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.balanceRow}>
        <View style={styles.balanceCopy}>
          <Text style={[styles.balance, spotDown || total === null ? styles.balanceLong : null]}>{spotDown || total === null ? "Price unavailable" : usd(total)}</Text>
          {delta !== null && percent !== null && total ? (
            <Text style={styles.changeLine}>
              <Text style={{ color: delta < 0 ? theme.danger : theme.mint }}>{`${signedUsd(delta)} (${signedPercent(percent)})`}</Text>
              <Text style={styles.rangeLabel}>{`  ${range}`}</Text>
            </Text>
          ) : (
            <Text style={styles.rangeLabel}>Mainnet total</Text>
          )}
        </View>
        <Sparkline points={series ?? []} dim={!series} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {CHAINS.map((chain) => {
          const on = chain.chainId === props.chainId;
          return (
            <Pressable key={chain.chainId} onPress={() => props.onChain(chain.chainId)} style={[styles.pill, on ? styles.pillOn : null]}>
              <ChainMark chainId={chain.chainId} size={18} />
              <Text style={[styles.pillText, on ? styles.pillTextOn : null]}>{chain.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <ActionTile icon="send" label="Send" onPress={props.onSend} />
        <ActionTile icon="receive" label="Receive" onPress={props.onReceive} />
        <ActionTile icon="swap" label="Swap" onPress={props.onSwap} />
      </View>

      <Pressable onPress={props.onSecurity}>
        <GlowCard>
          <View style={styles.securityRow}>
            <GlowIcon name="shieldCheck" />
            <View style={styles.securityCopy}>
              <View style={styles.nameRow}>
                <Text style={styles.cardTitle}>{props.securityTitle}</Text>
                <Chip label="KNOAD PROTECTION" />
              </View>
              <Text style={styles.body}>Each chain uses a separate spending key. Your assets stay safer by design.</Text>
            </View>
            <Icon name="chevronRight" size={18} color={theme.textMuted} />
          </View>
        </GlowCard>
      </Pressable>

      <View style={styles.tabs}>
        {(["assets", "nfts", "activity"] as const).map((item) => (
          <Pressable key={item} onPress={() => setSection(item)} style={styles.tab}>
            <Text style={[styles.tabText, section === item ? styles.tabTextOn : null]}>{item === "nfts" ? "NFTs" : item[0].toUpperCase() + item.slice(1)}</Text>
            {section === item ? <View style={styles.underline} /> : null}
          </Pressable>
        ))}
        <IconButton name="filter" label={chainOnly ? "Show every chain" : "Show this chain"} onPress={() => setChainOnly((current) => !current)} color={chainOnly ? theme.mint : theme.textMuted} />
      </View>

      {section === "nfts" ? <Text style={styles.empty}>This build does not list NFTs.</Text> : null}
      {section === "activity" ? (
        <View style={styles.log}>
          {props.log.length === 0 ? <Text style={styles.empty}>No activity yet.</Text> : null}
          {props.log
            .filter((item) => !chainOnly || item.chainId === props.chainId)
            .slice(0, 5)
            .map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          {props.log.length > 0 ? (
            <Pressable onPress={props.onOpenActivity}>
              <Text style={styles.link}>View all activity</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {section === "assets" && !props.ready ? <Text style={styles.empty}>Reading balances.</Text> : null}
      {section === "assets" && props.ready && rows.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.empty}>Your wallet is ready to receive.</Text>
          <Pressable onPress={props.onReceive}>
            <Text style={styles.link}>Receive</Text>
          </Pressable>
        </View>
      ) : null}
      {section === "assets"
        ? rows.map((row) => {
            const priced = !isTestnet(row.chainId) ? priceOf(row.symbol, spot) : { price: null, change: null };
            const fiat = priced.price === null ? null : Number(formatUnits(row.amount, row.decimals)) * priced.price;
            return (
              <Pressable key={row.key} onPress={() => props.onAsset(row)} style={styles.asset}>
                <TokenMark symbol={row.symbol} size={40} />
                <View style={styles.assetMain}>
                  <View style={styles.nameRow}>
                    <Text style={styles.symbol}>{row.symbol}</Text>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{row.chainName}</Text>
                    </View>
                  </View>
                  <Text style={styles.qty}>{`${trim(row.text)} ${row.symbol}`}</Text>
                </View>
                <View style={styles.assetValue}>
                  {isTestnet(row.chainId) ? (
                    <Chip label="TESTNET" tone="info" />
                  ) : (
                    <>
                      <Text style={styles.fiat}>{fiat === null ? "—" : usd(fiat)}</Text>
                      {priced.change !== null ? (
                        <Text style={{ color: priced.change < 0 ? theme.danger : theme.mint, fontFamily: theme.font.medium, fontSize: 12 }}>
                          {signedPercent(priced.change)}
                        </Text>
                      ) : null}
                    </>
                  )}
                </View>
                <Icon name="chevronRight" size={16} color={theme.textDim} />
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

function priceOf(symbol: string, spot: Spot | null): { price: number | null; change: number | null } {
  if (!spot) return { price: null, change: null };
  if (symbol === "USDC") return { price: spot.usdc, change: spot.usdcChange };
  if (symbol === "ETH" || symbol === "WETH") return { price: spot.eth, change: spot.ethChange };
  return { price: null, change: null };
}

function trim(text: string): string {
  if (text === "—") return text;
  const [whole, frac = ""] = text.split(".");
  return frac ? `${whole}.${frac.slice(0, 6).replace(/0+$/, "") || "0"}` : whole;
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  identity: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  identityMain: { flexDirection: "row", gap: 10, alignItems: "center", flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  address: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13 },
  ranges: { flexDirection: "row", gap: 4 },
  range: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: "transparent" },
  rangeOn: { borderColor: theme.mint },
  rangeText: { color: theme.textDim, fontFamily: theme.font.medium, fontSize: 12 },
  rangeTextOn: { color: theme.mint },
  balanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  balanceCopy: { flex: 1, gap: 4 },
  balance: { color: theme.text, fontFamily: theme.font.bold, fontSize: 40, letterSpacing: -1 },
  balanceLong: { fontSize: 26, letterSpacing: 0 },
  changeLine: { fontFamily: theme.font.medium, fontSize: 13 },
  rangeLabel: { color: theme.textDim, fontFamily: theme.font.medium, fontSize: 13 },
  pills: { flexDirection: "row", gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pillOn: { borderColor: theme.mint, backgroundColor: theme.mintTint },
  pillText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12 },
  pillTextOn: { color: theme.mint },
  actions: { flexDirection: "row", gap: 10 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  securityCopy: { flex: 1, gap: 4 },
  cardTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 18 },
  tabs: { flexDirection: "row", alignItems: "flex-end", gap: 16, marginTop: 4 },
  tab: { paddingBottom: 8 },
  tabText: { color: theme.textDim, fontFamily: theme.font.semibold, fontSize: 16 },
  tabTextOn: { color: theme.text },
  underline: { height: 2, backgroundColor: theme.mint, marginTop: 6, borderRadius: 2 },
  empty: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 15, lineHeight: 22 },
  emptyBlock: { gap: 8 },
  log: { gap: 8 },
  link: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 15 },
  asset: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
  },
  assetMain: { flex: 1, gap: 3 },
  symbol: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  badge: { borderRadius: 999, backgroundColor: theme.elevated, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: theme.info, fontFamily: theme.font.medium, fontSize: 11 },
  qty: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13 },
  assetValue: { alignItems: "flex-end", gap: 2 },
  fiat: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
});
