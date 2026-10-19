import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getAddress, isAddress } from "viem";
import { CHAINS, formatUnits, getChain, tokensForChain } from "@knoad/wallet-core";
import type { ActivityEntry } from "../activityLog";
import { readNetworkConditions, resolveName } from "../chain";
import { loadContacts, removeContact, renameContact, saveContact, type SavedContact } from "../contacts";
import { shortAddress, trimAmount, usd } from "../format";
import type { Spot } from "../prices";
import { isTestnet, theme } from "../theme";
import type { Holding } from "../useWallet";
import { Identicon, Inset } from "../ui/bits";
import { Chip, GhostButton, GlowCard, GlowIcon, IconButton, OutlineButton, PrimaryButton } from "../ui/chrome";
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
  onReview: (draft: { to: string; toName?: string; amount: string; symbol: string; fiat: string | null; fee: string | null }) => void;
  onBack: () => void;
  standard?: boolean;
}) {
  const [to, setTo] = useState(props.initialTo);
  const [amount, setAmount] = useState("");
  const native = getChain(props.chainId)?.native ?? { name: "Ether", symbol: "ETH", decimals: 18 };
  const [symbol, setSymbol] = useState(native.symbol);
  const [chainsOpen, setChainsOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [saved, setSaved] = useState<SavedContact[]>([]);
  const [resolved, setResolved] = useState<string | null>(null);
  const [lookup, setLookup] = useState<"idle" | "looking" | "missing">("idle");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const choices = [native.symbol, ...tokensForChain(props.chainId).filter((token) => !token.native).map((token) => token.symbol)];
  const holding = props.holdings.find((row) => row.chainId === props.chainId && row.symbol === symbol);
  const valid = Boolean(resolved);

  useEffect(() => {
    setTo(props.initialTo);
    setPickedName(null);
  }, [props.initialTo]);

  useEffect(() => {
    void loadContacts().then(setSaved);
  }, [contactsOpen]);

  useEffect(() => {
    if (isAddress(to)) {
      setResolved(getAddress(to));
      setLookup("idle");
      return;
    }
    const name = to.trim();
    if (!name.includes(".")) {
      setResolved(null);
      setLookup("idle");
      return;
    }
    setResolved(null);
    setLookup("looking");
    let live = true;
    const timer = setTimeout(() => {
      void resolveName(name, props.chainId).then((address) => {
        if (!live) return;
        setResolved(address);
        setLookup(address ? "idle" : "missing");
      });
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [to, props.chainId]);

  useEffect(() => {
    if (!choices.includes(symbol)) setSymbol(native.symbol);
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

  const price = !isTestnet(props.chainId) && props.spot ? (symbol === "USDC" ? props.spot.usdc : symbol === "ETH" || symbol === "WETH" ? props.spot.eth : null) : null;
  const numeric = Number(amount);
  const fiat = price !== null && Number.isFinite(numeric) ? usd(numeric * price) : null;
  const tooMuch = Boolean(holding && !holding.unavailable && Number.isFinite(numeric) && numeric > Number(holding.text));
  const feeText = feeWei === null ? null : trimAmount(formatUnits(feeWei, 18));
  const feeFiat = feeText && native.symbol === "ETH" && props.spot?.eth && !isTestnet(props.chainId) ? usd(Number(feeText) * props.spot.eth) : null;

  function max() {
    if (!holding || holding.unavailable) return;
    const spend = holding.native && feeWei && holding.amount > feeWei ? holding.amount - feeWei : holding.amount;
    setAmount(trimAmount(formatUnits(spend < 0n ? 0n : spend, holding.decimals)));
  }

  const favorite = saved.find((item) => resolved && item.address.toLowerCase() === resolved.toLowerCase());
  const typedName = !isAddress(to) && to.includes(".") ? to.trim() : null;
  const displayName = favorite?.name ?? pickedName ?? typedName;
  const nameHint = lookup === "looking" ? "Looking up the name." : lookup === "missing" ? "No address for this name." : resolved && typedName ? resolved : null;
  const savedAddresses = new Set(saved.map((item) => item.address.toLowerCase()));
  const contacts = props.recent
    .filter((item) => item.to && isAddress(item.to) && !savedAddresses.has(item.to.toLowerCase()))
    .filter((item, index, list) => list.findIndex((other) => other.to?.toLowerCase() === item.to?.toLowerCase()) === index);

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
          <Identicon seed={resolved ?? "knoad"} size={40} />
          <TextInput
            value={to}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Address or ENS name"
            placeholderTextColor={theme.textDim}
            style={styles.toInput}
            onChangeText={(value) => {
              setPickedName(null);
              setTo(value);
            }}
          />
          {valid ? <Icon name="checkCircle" size={18} color={theme.mint} /> : null}
          <IconButton name="scan" label="Scan address" onPress={props.onScan} />
          <IconButton name="contacts" label="Recipients" onPress={() => setContactsOpen(true)} />
        </View>
      </Inset>
      {nameHint ? <Text style={lookup === "missing" ? styles.warn : styles.meta}>{nameHint}</Text> : null}

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
              <Text style={styles.cardTitle}>{props.standard ? "Standard wallet" : "KNOAD security active"}</Text>
              {props.standard ? null : <Chip label="KNOAD PROTECTION" />}
            </View>
            <Text style={styles.meta}>
              {props.standard
                ? "This key does not change. The network fee is paid from this wallet."
                : `Your current spending key on ${props.chainName} will automatically retire after this transfer is included on-chain. A new key will be ready for your next transaction.`}
            </Text>
          </View>
        </View>
      </GlowCard>

      <View style={styles.summary}>
        <Text style={styles.cardTitle}>Transaction summary</Text>
        <Summary label="Send" value={amount ? `${amount} ${symbol}` : "—"} hint={fiat ?? undefined} />
        <Summary label="To" value={resolved ? (displayName ? `${displayName} · ${shortAddress(resolved)}` : shortAddress(resolved)) : "—"} />
        <Summary label="Network" value={props.chainName} />
        <Summary label="Estimated network fee" value={feeText ? `${feeText} ${native.symbol}` : "—"} hint={feeFiat ? `≈ ${feeFiat}` : undefined} />
      </View>

      {tooMuch ? <Text style={styles.warn}>More than your balance on this chain.</Text> : null}
      <PrimaryButton
        label="Review Send →"
        disabled={!valid || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || tooMuch}
        onPress={() => resolved && props.onReview({ to: resolved, toName: displayName ?? undefined, amount, symbol, fiat, fee: feeText })}
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
      <ContactsSheet
        open={contactsOpen}
        saved={saved}
        recent={contacts}
        onClose={() => setContactsOpen(false)}
        onPick={(address, name) => {
          setPickedName(name);
          setTo(address);
          setContactsOpen(false);
        }}
        onSaved={setSaved}
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

function ContactsSheet(props: {
  open: boolean;
  saved: SavedContact[];
  recent: ActivityEntry[];
  onClose: () => void;
  onPick: (address: string, name: string | null) => void;
  onSaved: (contacts: SavedContact[]) => void;
}) {
  const [draft, setDraft] = useState<{ address: string; name: string; ens?: string; editing: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (props.open) return;
    setDraft(null);
    setNotice("");
    setFormError("");
  }, [props.open]);

  function close() {
    setDraft(null);
    props.onClose();
  }

  async function commit() {
    if (!draft?.name.trim()) return;
    setFormError("");
    try {
      const next = draft.editing
        ? await renameContact(getAddress(draft.address), draft.name)
        : await saveContact({ address: getAddress(draft.address), name: draft.name, ens: draft.ens });
      props.onSaved(next);
      setNotice(draft.editing ? `Renamed to ${draft.name.trim()}.` : `Saved ${draft.name.trim()}.`);
      setDraft(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save that name.");
    }
  }

  async function remove() {
    if (!draft) return;
    const next = await removeContact(getAddress(draft.address));
    props.onSaved(next);
    setNotice("Removed from favorites.");
    setDraft(null);
  }

  const naming = draft ? (
    <KeyboardAvoidingView behavior="padding" style={styles.sheetLift}>
      <Pressable style={styles.sheet} onPress={() => undefined}>
        <Pressable onPress={() => setDraft(null)} style={styles.backRow} accessibilityLabel="Back to recipients">
          <Icon name="chevronLeft" size={18} color={theme.mint} />
          <Text style={styles.max}>Recipients</Text>
        </Pressable>
        <Text style={styles.cardTitle}>{draft.editing ? "Rename favorite" : "Save as favorite"}</Text>
        <Text style={styles.meta}>
          {draft.editing ? "Change the name on this phone, or remove it." : "Give this address a name. It stays on this phone."}
        </Text>
        <View style={styles.nameTarget}>
          <Identicon seed={draft.address} size={36} />
          <View style={styles.assetCopy}>
            <Text style={styles.value}>{shortAddress(draft.address)}</Text>
            {draft.ens ? <Text style={styles.meta}>{draft.ens}</Text> : null}
          </View>
        </View>
        <Text style={styles.label}>Name</Text>
        <TextInput
          value={draft.name}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          onChangeText={(name) => setDraft({ ...draft, name })}
          onSubmitEditing={() => void commit()}
          placeholder="Type a name"
          placeholderTextColor={theme.textDim}
          style={styles.nameInput}
        />
        {draft.name.trim() ? null : <Text style={styles.meta}>Type a name, then save.</Text>}
        {formError ? <Text style={styles.warn}>{formError}</Text> : null}
        <PrimaryButton label={draft.editing ? "Save name" : "Save favorite"} onPress={() => void commit()} disabled={!draft.name.trim()} />
        {draft.editing ? (
          <OutlineButton label="Remove favorite" tone="danger" onPress={() => void remove()} />
        ) : (
          <GhostButton label="Cancel" onPress={() => setDraft(null)} />
        )}
      </Pressable>
    </KeyboardAvoidingView>
  ) : (
    <View style={styles.sheet}>
      <Text style={styles.cardTitle}>Recipients</Text>
      <Text style={styles.meta}>Tap a row to fill Send. Save stores a name for that address on this phone.</Text>
      {notice ? <Text style={styles.savedNote}>{notice}</Text> : null}
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Favorites</Text>
        {props.saved.length === 0 ? <Text style={styles.meta}>No favorites yet. Save one from Recent.</Text> : null}
        {props.saved.map((item) => (
          <View key={item.address} style={styles.pick}>
            <Pressable style={styles.pickMain} onPress={() => props.onPick(item.address, item.name)}>
              <View style={styles.assetCopy}>
                <Text style={styles.value}>{item.name}</Text>
                <Text style={styles.meta}>{shortAddress(item.address)}</Text>
              </View>
            </Pressable>
            <Pressable
              style={styles.rowAction}
              onPress={() => {
                setNotice("");
                setFormError("");
                setDraft({ address: item.address, name: item.name, ens: item.ens, editing: true });
              }}
              accessibilityLabel={`Rename ${item.name}`}
            >
              <Icon name="pencil" size={18} color={theme.mint} />
              <Text style={styles.rowActionText}>Edit</Text>
            </Pressable>
          </View>
        ))}
        <Text style={styles.label}>Recent</Text>
        {props.recent.length === 0 ? <Text style={styles.meta}>No recent recipients.</Text> : null}
        {props.recent.map((item) => {
          const address = item.to ?? "";
          return (
            <View key={address} style={styles.pick}>
              <Pressable style={styles.pickMain} onPress={() => props.onPick(address, item.toName ?? null)}>
                <Text style={styles.value}>{item.toName ?? shortAddress(address)}</Text>
                {item.toName ? <Text style={styles.meta}>{shortAddress(address)}</Text> : null}
              </Pressable>
              <Pressable
                style={styles.rowAction}
                onPress={() => {
                  setNotice("");
                  setFormError("");
                  setDraft({ address, name: item.toName ?? "", ens: item.toName, editing: false });
                }}
                accessibilityLabel="Save as favorite"
              >
                <Icon name="star" size={18} color={theme.mint} />
                <Text style={styles.rowActionText}>Save</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <Modal visible={props.open} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        {naming}
      </Pressable>
    </Modal>
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
  sheetLift: { width: "100%", justifyContent: "flex-end" },
  sheetScroll: { maxHeight: 420 },
  pick: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  pickMain: { flex: 1 },
  rowAction: { alignItems: "center", gap: 2, minWidth: 44, paddingVertical: 4 },
  rowActionText: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 11 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  nameTarget: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.elevated, borderRadius: theme.radius.md, padding: 12 },
  nameInput: {
    color: theme.text,
    backgroundColor: theme.elevated,
    borderColor: theme.mint,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: 14,
    fontFamily: theme.font.medium,
    fontSize: 18,
  },
  savedNote: { color: theme.mint, fontFamily: theme.font.medium, fontSize: 14 },
});
