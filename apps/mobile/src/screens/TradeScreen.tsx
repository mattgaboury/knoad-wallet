import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatUnits, getChain, type CommerceQuote, type ListedToken } from "@knoad/wallet-core";
import { COMMERCE_SUBMIT_ENABLED } from "../config";
import { shortAddress, trimAmount } from "../format";
import { theme } from "../theme";
import type { QuoteView } from "../useCommerce";
import type { Holding } from "../useWallet";
import { PageTitle, PrimaryButton } from "../ui/chrome";
import { Icon } from "../ui/icons";
import { TokenMark } from "../ui/marks";

export function TradeScreen(props: {
  sellTokens: ListedToken[];
  buyTokens: ListedToken[];
  sell?: ListedToken;
  buy?: ListedToken;
  amount: string;
  holdings: Holding[];
  chainId: number;
  chainName: string;
  view: QuoteView | null;
  bridge: { status: string } | null;
  busy: boolean;
  onAmount: (value: string) => void;
  onSell: (token: ListedToken) => void;
  onBuy: (token: ListedToken) => void;
  onFlip: () => void;
  onQuote: () => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const quote = props.view?.quote ?? null;
  const sellHolding = props.holdings.find((row) => row.chainId === props.chainId && row.symbol === props.sell?.symbol);
  const viewOnly = Boolean(quote) && !COMMERCE_SUBMIT_ENABLED;
  const blocked = Boolean(props.view?.gasShort);
  const bridging = Boolean(props.sell && props.buy && props.sell.chainId !== props.buy.chainId);
  const title = "Swap";
  const destName = getChain(props.buy?.chainId ?? props.chainId)?.name ?? props.chainName;
  const tokenOf = (address: string) =>
    [...props.sellTokens, ...props.buyTokens].find((token) => token.address.toLowerCase() === address.toLowerCase());

  return (
    <View style={styles.wrap}>
      <Pressable onPress={props.onBack} style={styles.back} accessibilityLabel="Back">
        <Icon name="chevronLeft" size={22} color={theme.text} />
      </Pressable>
      <PageTitle title={title} subtitle={props.sellTokens.length === 0 ? "Available on Ethereum and Base." : "Review the quote before anything is signed."} />
      <View>
        <Panel
          label="From"
          token={props.sell}
          tokens={props.sellTokens}
          chainName={props.chainName}
          amount={props.amount}
          onAmount={props.onAmount}
          balance={sellHolding && !sellHolding.unavailable ? `${trimAmount(sellHolding.text)} ${sellHolding.symbol}` : null}
          onMax={sellHolding ? () => props.onAmount(sellHolding.text) : undefined}
          onPick={props.onSell}
        />
        <Pressable onPress={props.onFlip} style={styles.flip} accessibilityLabel="Switch tokens">
          <Icon name="swap" color={theme.mint} size={18} />
        </Pressable>
        <Panel
          label="To"
          token={props.buy}
          tokens={props.buyTokens}
          chainName={destName}
          amount={quote && props.buy ? trimAmount(formatUnits(quote.minBuyAmount, props.buy.decimals)) : ""}
          caption={quote ? "Minimum received" : undefined}
          onPick={props.onBuy}
          readOnly
        />
      </View>

      <View style={styles.rateRow}>
        <Text style={styles.meta}>
          {quote && props.sell && props.buy ? `1 ${props.sell.symbol} = ${rate(quote, props.sell, props.buy)} ${props.buy.symbol}` : "Get a quote to see the rate."}
        </Text>
        {quote ? (
          <Pressable onPress={props.onQuote} accessibilityLabel="Refresh quote" style={styles.refresh}>
            <Icon name="rotate" size={16} color={theme.mint} />
          </Pressable>
        ) : null}
        <Text style={styles.slippage}>{`Slippage ${((quote?.slippageBps ?? 50) / 100).toFixed(2)}%`}</Text>
      </View>

      {quote ? (
        <View style={styles.card}>
          <Line label="Network fee" value={`Up to ${trimAmount(formatUnits(quote.networkFeeWei, 18))} ETH`} />
          <Line label="Provider fee" value={feeText(quote.providerFee, tokenOf)} />
          <Line label="KNOAD fee" value={(quote.knoadFee.bps ?? 0) === 0 && quote.knoadFee.amount === 0n ? "None" : feeText(quote.knoadFee, tokenOf)} />
          <Line label="Route" value={quote.protocols.length > 0 ? quote.protocols.join(", ") : quote.route} />
          {quote.approvals.map((approval) => {
            const token = tokenOf(approval.token);
            const amount = token ? `${trimAmount(formatUnits(approval.amount, token.decimals))} ${token.symbol}` : "this token";
            return <Line key={`${approval.token}${approval.spender}`} label="Approval" value={`Lets ${shortAddress(approval.spender)} use ${amount}`} />;
          })}
          {props.view?.simulatedReceived ? <Line label="Simulated" value={`Receives ${props.view.simulatedReceived}`} /> : null}
          {props.view?.simulationNote ? <Text style={styles.meta}>{props.view.simulationNote}</Text> : null}
        </View>
      ) : null}

      {props.bridge ? (
        <Text style={props.bridge.status === "DONE" ? styles.landed : props.bridge.status === "FAILED" ? styles.failed : styles.note}>
          {bridgeLine(props.bridge.status)}
        </Text>
      ) : null}
      {blocked ? <Text style={styles.note}>Add ETH on this chain to pay the network.</Text> : null}
      {viewOnly ? <Text style={styles.note}>{bridging ? "Bridges are view-only in this build." : "Swaps are view-only in this build."}</Text> : null}
      <PrimaryButton
        label={props.busy ? "Quoting" : quote ? (bridging ? "Bridge →" : "Swap Tokens →") : "Get Quote"}
        disabled={props.busy || props.sellTokens.length === 0 || viewOnly || blocked}
        onPress={quote ? props.onConfirm : props.onQuote}
      />
    </View>
  );
}

function bridgeLine(status: string): string {
  if (status === "DONE") return "The bridge landed.";
  if (status === "FAILED") return "The bridge failed.";
  return "The bridge is in transit.";
}

function rate(quote: CommerceQuote, sell: ListedToken, buy: ListedToken): string {
  const paid = Number(formatUnits(quote.sellAmount, sell.decimals));
  const received = Number(formatUnits(quote.minBuyAmount, buy.decimals));
  if (!paid) return "—";
  return (received / paid).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function feeText(fee: CommerceQuote["providerFee"], tokenOf: (address: string) => ListedToken | undefined): string {
  if (!fee) return "None";
  const token = tokenOf(fee.token);
  if (token && fee.amount > 0n) return `${trimAmount(formatUnits(fee.amount, token.decimals))} ${token.symbol}`;
  if (fee.bps !== null) return `${(fee.bps / 100).toFixed(2)}%`;
  return "Included";
}

function Line(props: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{props.label}</Text>
      <Text style={styles.lineValue}>{props.value}</Text>
    </View>
  );
}

function Panel(props: {
  label: string;
  token?: ListedToken;
  tokens: ListedToken[];
  chainName: string;
  amount: string;
  caption?: string;
  onAmount?: (value: string) => void;
  balance?: string | null;
  onMax?: () => void;
  onPick: (token: ListedToken) => void;
  readOnly?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.label}>{props.label}</Text>
        {props.balance ? (
          <View style={styles.balance}>
            <Text style={styles.meta}>{`Balance: ${props.balance}`}</Text>
            {props.onMax ? (
              <Pressable onPress={props.onMax} style={styles.maxChip} accessibilityLabel="Use max">
                <Text style={styles.max}>MAX</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.panelRow}>
        <Pressable style={styles.tokenCard} onPress={() => props.tokens.length > 0 && setPicking(true)} accessibilityLabel={`${props.label} token`}>
          {props.token ? <TokenMark symbol={props.token.symbol} size={30} /> : <Icon name="asset" size={24} color={theme.textDim} />}
          <View style={styles.tokenCopy}>
            <View style={styles.inline}>
              <Text style={styles.tokenText}>{props.token?.symbol ?? "Select"}</Text>
              <Icon name="chevronDown" size={14} color={theme.textMuted} />
            </View>
            <Text style={styles.badge}>{props.chainName}</Text>
          </View>
        </Pressable>
        <View style={styles.amountWell}>
          <TextInput
            value={props.amount}
            onChangeText={props.onAmount}
            editable={!props.readOnly}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={theme.textDim}
            style={styles.amount}
          />
          {props.caption ? <Text style={styles.caption}>{props.caption}</Text> : null}
        </View>
      </View>
      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{`${props.label} token`}</Text>
            {props.tokens.map((token) => (
              <Pressable
                key={`${token.chainId}:${token.address}`}
                style={[styles.option, props.token?.chainId === token.chainId && props.token.address === token.address ? styles.optionOn : null]}
                onPress={() => {
                  props.onPick(token);
                  setPicking(false);
                }}
              >
                <TokenMark symbol={token.symbol} size={28} />
                <Text style={styles.tokenText}>{token.symbol}</Text>
                <Text style={styles.badge}>{getChain(token.chainId)?.name ?? props.chainName}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  back: { width: 36, height: 36, justifyContent: "center" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillOn: { borderColor: theme.mint, backgroundColor: theme.mintTint },
  pillText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  pillTextOn: { color: theme.mint },
  panel: { backgroundColor: theme.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 12 },
  panelHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  panelRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  balance: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  maxChip: { borderWidth: 1, borderColor: theme.borderMint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  max: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 11 },
  tokenCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.inset,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tokenCopy: { gap: 2 },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  tokenText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  badge: { color: theme.info, fontFamily: theme.font.medium, fontSize: 11 },
  amountWell: { flex: 1, alignItems: "flex-end" },
  amount: { alignSelf: "stretch", color: theme.text, fontFamily: theme.font.bold, fontSize: 28, textAlign: "right" },
  caption: { color: theme.textDim, fontFamily: theme.font.regular, fontSize: 12 },
  flip: {
    alignSelf: "center",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: theme.mint,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -14,
    zIndex: 2,
  },
  rateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  refresh: { padding: 4 },
  slippage: { marginLeft: "auto", color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineLabel: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13 },
  lineValue: { flex: 1, color: theme.text, fontFamily: theme.font.medium, fontSize: 13, textAlign: "right" },
  note: { color: theme.warning, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
  landed: { color: theme.mint, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
  failed: { color: theme.danger, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10 },
  sheetTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 18, marginBottom: 4 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.border },
  optionOn: { borderColor: theme.mint, backgroundColor: theme.mintTint },
});
