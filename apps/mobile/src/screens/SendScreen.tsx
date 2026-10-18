import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { isAddress } from "viem";
import { CHAINS, formatUnits, tokensForChain } from "@knoad/wallet-core";
import type { ActivityEntry } from "../activityLog";
import { readNetworkConditions } from "../chain";
import { shortAddress, trimAmount, usd } from "../format";
import type { Spot } from "../prices";
import { isTestnet, theme } from "../theme";
import type { Holding } from "../useWallet";
import { Identicon, Inset } from "../ui/bits";
import { Chip, GlowCard, GlowIcon, IconButton, PrimaryButton } from "../ui/chrome";
import { Icon } from "../ui/icons";
import { ChainMark, TokenMark } from "../ui/marks";

export function SendScreen(props: {
  chainId: number;
  chainName: string;
  initialTo: string;
  holdings: Holding[];
  spot: Spot | null;
  recent: ActivityEntry[];
  onChain: (chainId: number) => void;
  onScan: () => void;
  onReview: (draft: { to: string; amount: string; symbol: string; fiat: string | null; fee: string | null }) => void;
  onBack: () => void;
}) {
  const [to, setTo] = useState(props.initialTo);
  const [amount, setAmount] = useState("");
  const [symbol, setSymbol] = useState("ETH");
  const [chainsOpen, setChainsOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const choices = ["ETH", ...tokensForChain(props.chainId).filter((token) => !token.native).map((token) => token.symbol)];
  const holding = props.holdings.find((row) => row.chainId === props.chainId && row.symbol === symbol);
  const valid = isAddress(to);

  useEffect(() => {
    setTo(props.initialTo);
  }, [props.initialTo]);

  useEffect(() => {
    if (!choices.includes(symbol)) setSymbol("ETH");
  }, [props.chainId]);

  useEffect(() => {
    let live = true;
    void readNetworkConditions(props.chainId).then((next) => {
      if (live) setFeeWei(next ? 150_000n * next.maxFee : null);
    });
    return () => {
      live = false;
    };
  }, [props.chainId]);

  const price = !isTestnet(props.chainId) && props.spot ? (symbol === "USDC" ? props.spot.usdc : props.spot.eth) : null;
  const numeric = Number(amount);
  const fiat = price !== null && Number.isFinite(numeric) ? usd(numeric * price) : null;
  const tooMuch = Boolean(holding && !holding.unavailable && Number.isFinite(numeric) && numeric > Number(holding.text));
  const feeText = feeWei === null ? null : trimAmount(formatUnits(feeWei, 18));
  const feeFiat = feeText && props.spot?.eth && !isTestnet(props.chainId) ? usd(Number(feeText) * props.spot.eth) : null;

  function max() {
    if (!holding || holding.unavailable) return;
    const spend = holding.native && feeWei && holding.amount > feeWei ? holding.amount - feeWei : holding.amount;
    setAmount(trimAmount(formatUnits(spend < 0n ? 0n : spend, holding.decimals)));
  }

  const contacts = props.recent.filter((item) => item.to && isAddress(item.to)).filter((item, index, list) => list.findIndex((other) => other.to === item.to) === index);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={props.onBack} hitSlop={8} accessibilityLabel="Back">
          <Icon name="chevronLeft" size={24} color={theme.text} />
        </Pressable>
        <View>
          <Text style={styles.title}>Send</Text>
          <Pressable onPress={() => setChainsOpen(true)} style={styles.chainButton}>
            <ChainMark chainId={props.chainId} size={16} />
            <Text style={styles.chainName}>{props.chainName}</Text>
            <Icon name="chevronDown" size={14} color={theme.mint} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.label}>To</Text>
      <Inset>
        <View style={styles.toRow}>
          <Identicon seed={valid ? to : "knoad"} size={40} />
          <TextInput
            value={to}
            onChangeText={setTo}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Address"
            placeholderTextColor={theme.textDim}
            style={styles.toInput}
          />
          {valid ? <Icon name="checkCircle" size={18} color={theme.mint} /> : null}
          <IconButton name="scan" label="Scan address" onPress={props.onScan} />
          <IconButton name="contacts" label="Recent recipients" onPress={() => setContactsOpen(true)} />
        </View>
      </Inset>

      <Text style={styles.label}>Asset</Text>
      <Pressable onPress={() => setAssetsOpen(true)}>
        <Inset>
          <View style={styles.toRow}>
            <TokenMark symbol={symbol} size={36} />
            <View style={styles.assetCopy}>
              <View style={styles.inline}>
                <Text style={styles.symbol}>{symbol}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{props.chainName}</Text>
                </View>
              </View>
              <Text style={styles.meta}>{holding && !holding.unavailable ? `${trimAmount(holding.text)} ${symbol}` : "Balance unavailable"}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={theme.textMuted} />
          </View>
        </Inset>
      </Pressable>

      <View style={styles.amountHead}>
        <Text style={styles.label}>Amount</Text>
        <Text style={styles.meta}>
          {holding && !holding.unavailable ? `Balance: ${trimAmount(holding.text)} ${symbol}  ` : ""}
          <Text style={styles.max} onPress={max}>
            Max
          </Text>
        </Text>
      </View>
      <Inset>
        <View style={styles.amountRow}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={theme.textDim}
            selectionColor={theme.mint}
            style={styles.amountInput}
          />
          <View style={styles.amountSide}>
            <Text style={styles.symbol}>{symbol}</Text>
            <Text style={styles.meta}>{fiat ? `≈ ${fiat}` : isTestnet(props.chainId) ? "Testnet" : "—"}</Text>
          </View>
        </View>
      </Inset>

      <GlowCard>
        <View style={styles.security}>
          <GlowIcon name="shieldCheck" />
          <View style={styles.assetCopy}>
            <View style={styles.inline}>
              <Text style={styles.cardTitle}>KNOAD security active</Text>
              <Chip label="KNOAD PROTECTION" />
            </View>
            <Text style={styles.meta}>
              {`Your current spending key on ${props.chainName} will automatically retire after this transfer is included on-chain. A new key will be ready for your next transaction.`}
            </Text>
          </View>
        </View>
      </GlowCard>

      <View style={styles.summary}>
        <Text style={styles.cardTitle}>Transaction summary</Text>
        <Summary label="Send" value={amount ? `${amount} ${symbol}` : "—"} hint={fiat ?? undefined} />
        <Summary label="To" value={valid ? shortAddress(to) : "—"} />
        <Summary label="Network" value={props.chainName} />
        <Summary label="Estimated network fee" value={feeText ? `${feeText} ETH` : "—"} hint={feeFiat ? `≈ ${feeFiat}` : undefined} />
      </View>

      {tooMuch ? <Text style={styles.warn}>More than your balance on this chain.</Text> : null}
      <PrimaryButton
        label="Review Send →"
        disabled={!valid || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || tooMuch}
        onPress={() => props.onReview({ to, amount, symbol, fiat, fee: feeText })}
      />

      <Picker
        open={chainsOpen}
        title="Network"
        onClose={() => setChainsOpen(false)}
        rows={CHAINS.map((chain) => ({ id: String(chain.chainId), label: chain.name, chainId: chain.chainId }))}
        onPick={(id) => {
          props.onChain(Number(id));
          setChainsOpen(false);
        }}
      />
      <Picker
        open={assetsOpen}
        title="Asset"
        onClose={() => setAssetsOpen(false)}
        rows={choices.map((item) => ({ id: item, label: item }))}
        onPick={(id) => {
          setSymbol(id);
          setAssetsOpen(false);
        }}
      />
      <Picker
        open={contactsOpen}
        title="Recent"
        onClose={() => setContactsOpen(false)}
        rows={contacts.map((item) => ({ id: item.to ?? "", label: shortAddress(item.to ?? "") }))}
        empty="No recent recipients."
        onPick={(id) => {
          setTo(id);
          setContactsOpen(false);
        }}
      />
    </View>
  );
}

function Summary(props: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.meta}>{props.label}</Text>
      <View style={styles.summaryValue}>
        <Text style={styles.value}>{props.value}</Text>
        {props.hint ? <Text style={styles.meta}>{props.hint}</Text> : null}
      </View>
    </View>
  );
}

function Picker(props: {
  open: boolean;
  title: string;
  rows: { id: string; label: string; chainId?: number }[];
  empty?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={props.open} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose}>
        <View style={styles.sheet}>
          <Text style={styles.cardTitle}>{props.title}</Text>
          {props.rows.length === 0 ? <Text style={styles.meta}>{props.empty ?? "Nothing here."}</Text> : null}
          {props.rows.map((row) => (
            <Pressable key={row.id} style={styles.pick} onPress={() => props.onPick(row.id)}>
              {row.chainId ? <ChainMark chainId={row.chainId} size={22} /> : null}
              <Text style={styles.value}>{row.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  warn: { color: theme.warning, fontFamily: theme.font.regular, fontSize: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: theme.text, fontFamily: theme.font.bold, fontSize: 28 },
  chainButton: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  chainName: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 14 },
  label: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  toRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  toInput: { flex: 1, color: theme.text, fontFamily: theme.font.medium, fontSize: 14 },
  assetCopy: { flex: 1, gap: 3 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  symbol: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  badge: { backgroundColor: theme.elevated, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: theme.info, fontFamily: theme.font.medium, fontSize: 11 },
  meta: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 18 },
  amountHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  max: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 13 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  amountInput: { flex: 1, color: theme.text, fontFamily: theme.font.bold, fontSize: 34 },
  amountSide: { alignItems: "flex-end" },
  security: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  cardTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  summary: {
    backgroundColor: theme.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 10,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  summaryValue: { alignItems: "flex-end", flex: 1 },
  value: { color: theme.text, fontFamily: theme.font.medium, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  pick: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
});
