import { useEffect, useState } from "react";
import { BackHandler, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { getChain, type PendingSend } from "@knoad/wallet-core";
import type { ActivityEntry } from "../activityLog";
import { readNetworkConditions } from "../chain";
import { gwei, pendingFor, shortAddress } from "../format";
import { theme } from "../theme";
import { PageTitle, Toggle } from "../ui/chrome";
import { Icon, type IconName } from "../ui/icons";
import { ChainMark, TokenMark } from "../ui/marks";

export function ActivityScreen(props: {
  pending: { chainId: number; pending: PendingSend } | null;
  log: ActivityEntry[];
  auto: boolean;
  onAuto: (next: boolean) => void;
  onSpeed: () => void;
  onCancel: () => void;
  onFix: (recommend: "speed" | "cancel") => void;
}) {
  const [gas, setGas] = useState<{ base: bigint; priority: bigint; maxFee: bigint } | null>(null);
  const waiting = props.pending;

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    void readNetworkConditions(waiting.chainId).then((next) => {
      if (live) setGas(next);
    });
    return () => {
      live = false;
    };
  }, [waiting?.chainId, waiting?.pending.userOpHash]);

  const [openId, setOpenId] = useState<string | null>(null);
  const rows = rowsFor(props.log, waiting);
  const open = rows.find((item) => item.id === openId) ?? null;
  const live = open && waiting && waiting.pending.userOpHash === open.hash ? waiting : null;

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpenId(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (open) {
    return live ? (
      <PendingDetail
        waiting={live}
        gas={gas}
        auto={props.auto}
        onAuto={props.onAuto}
        onSpeed={props.onSpeed}
        onCancel={props.onCancel}
        onFix={props.onFix}
        onBack={() => setOpenId(null)}
      />
    ) : (
      <SettledDetail item={open} onBack={() => setOpenId(null)} />
    );
  }

  return (
    <View style={styles.wrap}>
      <PageTitle title="Activity" subtitle="Sends and received NFTs." />
      {rows.length === 0 ? <Text style={styles.body}>No activity yet.</Text> : null}
      {rows.map((item) => (
        <Pressable key={item.id} onPress={() => setOpenId(item.id)} accessibilityRole="button">
          <ActivityRow item={item} />
        </Pressable>
      ))}
    </View>
  );
}

function PendingDetail(props: {
  waiting: { chainId: number; pending: PendingSend };
  gas: { base: bigint; priority: bigint; maxFee: bigint } | null;
  auto: boolean;
  onAuto: (next: boolean) => void;
  onSpeed: () => void;
  onCancel: () => void;
  onFix: (recommend: "speed" | "cancel") => void;
  onBack: () => void;
}) {
  const pending = props.waiting.pending;
  const chain = getChain(props.waiting.chainId);
  const low = props.gas ? BigInt(pending.maxFeePerGas) < props.gas.base + props.gas.priority : false;
  const recommend = low || pending.kind === "send" ? "speed" : "cancel";
  return (
    <View style={styles.wrap}>
      <BackRow onPress={props.onBack} />
      <PageTitle title="Pending send" subtitle={low ? "The fee is below the network." : "Waiting for the network."} />
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Transaction Details</Text>
          <View style={styles.pendingChip}>
            <View style={styles.dot} />
            <Text style={styles.pendingText}>Pending</Text>
          </View>
        </View>
        <Detail icon="asset" label="Network" value={chain?.name ?? "Network"} chainId={props.waiting.chainId} />
        <Detail icon="nonce" label="Nonce" value={pending.nonce} />
        <Detail icon="asset" label="Asset" value={pending.asset ?? "—"} symbol={pending.asset} />
        <Detail icon="asset" label="Amount" value={pending.amount && pending.asset ? `${pending.amount} ${pending.asset}` : "—"} />
        <Detail icon="gas" label="Fee" value={gwei(pending.maxFeePerGas)} chip={low ? "Low" : props.gas ? "OK" : undefined} chipTone={low ? "danger" : "mint"} />
        <Detail icon="clock" label="Time Pending" value={pending.sentAt ? pendingFor(pending.sentAt) : "—"} />
        <Pressable onPress={() => void Clipboard.setStringAsync(pending.userOpHash)}>
          <Detail icon="hash" label="Operation hash" value={shortAddress(pending.userOpHash)} />
        </Pressable>
      </View>
      <Text style={styles.body}>
        {low ? "Raise the fee, or replace this with an empty operation." : "The fee is enough. You can still raise it, or replace this with an empty operation."}
      </Text>
      <View style={styles.actions}>
        <Pressable style={[styles.action, styles.actionMint]} onPress={props.onSpeed}>
          <Icon name="rocket" color={theme.mint} />
          <Text style={styles.actionTitle}>Speed Up</Text>
          <Text style={styles.actionBody}>Replace with higher gas</Text>
        </Pressable>
        <Pressable style={[styles.action, styles.actionDanger]} onPress={props.onCancel}>
          <Icon name="xCircle" color={theme.danger} />
          <Text style={[styles.actionTitle, { color: theme.danger }]}>Cancel</Text>
          <Text style={styles.actionBody}>Replace with an empty operation</Text>
        </Pressable>
        <Pressable style={[styles.action, styles.actionFill]} onPress={() => props.onFix(recommend)}>
          <Icon name="wand" color={theme.onMint} />
          <Text style={[styles.actionTitle, { color: theme.onMint }]}>Auto Clear Nonce</Text>
          <Text style={[styles.actionBody, { color: theme.onMint }]}>Fix pending transaction</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <View style={styles.auto}>
          <Icon name="clock" color={theme.mint} />
          <View style={styles.copy}>
            <Text style={styles.rowTitle}>Automatic Recovery</Text>
            <Text style={styles.body}>If still pending after 15 minutes, prepare a replacement with a higher fee.</Text>
          </View>
          <Toggle on={props.auto} onChange={props.onAuto} label="Automatic recovery" />
        </View>
      </View>
    </View>
  );
}

function SettledDetail(props: { item: ActivityEntry; onBack: () => void }) {
  const item = props.item;
  const chain = getChain(item.chainId);
  const tx = item.txHash;
  return (
    <View style={styles.wrap}>
      <BackRow onPress={props.onBack} />
      <PageTitle title={labelFor(item)} subtitle={statusWord(item.status)} />
      <View style={styles.card}>
        <Detail icon="asset" label="Network" value={chain?.name ?? "Network"} chainId={item.chainId} />
        {item.nonce ? <Detail icon="nonce" label="Nonce" value={item.nonce} /> : null}
        <Detail icon="asset" label="Amount" value={item.amount && item.asset ? `${item.amount} ${item.asset}` : "—"} symbol={item.asset} />
        <Detail icon="hash" label="Status" value={statusWord(item.status)} />
        <Pressable onPress={() => void Clipboard.setStringAsync(item.hash)}>
          <Detail icon="hash" label="Operation hash" value={shortAddress(item.hash)} />
        </Pressable>
      </View>
      <Text style={styles.body}>{explain(item)}</Text>
      {tx && chain?.explorer ? (
        <Pressable onPress={() => void Linking.openURL(`${chain.explorer}/tx/${tx}`)}>
          <Text style={styles.explorer}>View on explorer</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BackRow(props: { onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
      <Icon name="chevronLeft" size={18} color={theme.text} />
      <Text style={styles.rowTitle}>Activity</Text>
    </Pressable>
  );
}

function rowsFor(log: ActivityEntry[], waiting: { chainId: number; pending: PendingSend } | null): ActivityEntry[] {
  if (!waiting) return log;
  if (log.some((item) => item.hash === waiting.pending.userOpHash)) return log;
  return [
    {
      id: waiting.pending.userOpHash,
      chainId: waiting.chainId,
      kind: waiting.pending.kind === "cancel" ? "cancel" : "send",
      hash: waiting.pending.userOpHash,
      amount: waiting.pending.amount,
      asset: waiting.pending.asset,
      to: waiting.pending.to,
      time: waiting.pending.sentAt ?? Date.now(),
      status: "pending",
      nonce: waiting.pending.nonce,
    },
    ...log,
  ];
}

function explain(item: ActivityEntry): string {
  const reason = (item.reason ?? "").trim();
  const generic = !reason || reason === "0x" || reason.startsWith("0x") || /execution reverted/i.test(reason);
  if (item.status === "failed") {
    if (!generic) return reason;
    return "The fee was paid, then the payment step failed. The ETH stayed in this account.";
  }
  if (item.status === "included") return "Included.";
  if (item.status === "cancelled") return "Cancelled. The transfer was not sent.";
  if (item.status === "replaced") return "Replaced by a later fee.";
  return "This phone has no replacement waiting for this send.";
}

function statusWord(status: ActivityEntry["status"]): string {
  if (status === "included") return "Included";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "replaced") return "Replaced";
  return "Pending";
}

function Detail(props: { icon: IconName; label: string; value: string; chainId?: number; symbol?: string; chip?: string; chipTone?: "danger" | "mint" }) {
  return (
    <View style={styles.detail}>
      <Icon name={props.icon} size={16} color={theme.textDim} />
      <Text style={styles.detailLabel}>{props.label}</Text>
      <View style={styles.detailValue}>
        {props.chainId ? <ChainMark chainId={props.chainId} size={16} /> : null}
        {props.symbol && props.symbol !== "—" ? <TokenMark symbol={props.symbol} size={16} /> : null}
        <Text style={styles.value}>{props.value}</Text>
        {props.chip ? <Text style={[styles.chip, { color: props.chipTone === "danger" ? theme.danger : theme.mint }]}>{props.chip}</Text> : null}
      </View>
    </View>
  );
}

export function ActivityRow(props: { item: ActivityEntry }) {
  const item = props.item;
  return (
    <View style={styles.logRow}>
      <Icon name={iconFor(item.status)} size={18} color={colorFor(item.status)} />
      <View style={styles.copy}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {labelFor(item)}
        </Text>
        <Text style={styles.body} numberOfLines={1}>{`${getChain(item.chainId)?.name ?? "Network"} · ${statusWord(item.status)}`}</Text>
      </View>
      <Icon name="chevronRight" size={16} color={theme.textDim} />
    </View>
  );
}

function iconFor(status: ActivityEntry["status"]): IconName {
  if (status === "included") return "included";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "xCircle";
  if (status === "replaced") return "replaced";
  return "pending";
}

function colorFor(status: ActivityEntry["status"]): string {
  if (status === "failed" || status === "cancelled") return theme.danger;
  if (status === "pending") return theme.warning;
  return theme.mint;
}

function labelFor(item: ActivityEntry): string {
  const amount = item.amount && item.asset ? `${item.amount} ${item.asset}` : item.asset ?? "Operation";
  if (item.kind === "cancel") return `Cancel ${amount}`;
  if (item.kind === "speed") return `Speed up ${amount}`;
  if (item.kind === "swap") return `Swap ${amount} to ${item.to ?? "token"}`;
  if (item.kind === "bridge") return `Bridge ${amount} to ${item.to ?? "another chain"}`;
  if (item.kind === "site") return item.asset ?? "Site transaction";
  if (item.kind === "nft") {
    const label = [item.asset, item.amount].filter(Boolean).join(" ");
    return item.toName ? `Send ${label} to ${item.toName}` : `Received ${label}`;
  }
  return item.toName ? `Send ${amount} to ${item.toName}` : `Send ${amount}`;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 17 },
  pendingChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.warningTint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.warning },
  pendingText: { color: theme.warning, fontFamily: theme.font.semibold, fontSize: 12 },
  alert: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  copy: { flex: 1, gap: 4 },
  warnTitle: { color: theme.warning, fontFamily: theme.font.semibold, fontSize: 16 },
  rowTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
  detail: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailLabel: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, width: 120 },
  detailValue: { flex: 1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 6 },
  value: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13 },
  chip: { fontFamily: theme.font.semibold, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1, borderRadius: theme.radius.lg, borderWidth: 1, padding: 10, gap: 6, minHeight: 118 },
  actionMint: { borderColor: theme.borderMint, backgroundColor: theme.card },
  actionDanger: { borderColor: theme.danger, backgroundColor: theme.dangerTint },
  actionFill: { borderColor: theme.mint, backgroundColor: theme.mint },
  actionTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  actionBody: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 11, lineHeight: 15 },
  auto: { flexDirection: "row", gap: 10, alignItems: "center" },
  back: { flexDirection: "row", alignItems: "center", gap: 6 },
  explorer: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 14 },
  logRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    backgroundColor: theme.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
  },
});
