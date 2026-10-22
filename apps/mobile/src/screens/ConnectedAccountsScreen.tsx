import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { createURL } from "expo-linking";
import { DEFAULT_CHAIN_ID } from "../config";
import { shortAddress } from "../format";
import { createIdentityClient, IdentityRequestError, type WalletAppAccount } from "../identity/client";
import { initialSelection, linkSelection, LINK_COPY, staysUnlinked } from "../identity/copy";
import { identityCodeFromLink } from "../identity/link";
import { clearLinkSession, readLinkSession, saveLinkSession } from "../identity/session";
import { theme } from "../theme";
import { Card, OutlineButton, PageTitle, PrimaryButton } from "../ui/chrome";

const ERC6492_MARK = "6492649264926492649264926492649264926492649264926492649264926492";

WebBrowser.maybeCompleteAuthSession();

type WalletRow = { id: string; name: string; address: string; kind: "knoad" | "standard" };

export function ConnectedAccountsScreen(props: {
  apiUrl: string;
  wallets: WalletRow[];
  activeId: string | null;
  handoff: { code: string; state: string } | null;
  onHandoffConsumed: () => void;
  onApprove: (summary: string) => Promise<boolean>;
  onSign: (walletId: string, message: string) => Promise<string>;
  onBack: () => void;
}) {
  const client = useMemo(() => createIdentityClient(props.apiUrl), [props.apiUrl]);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<WalletAppAccount | null>(null);
  const [phase, setPhase] = useState<"ready" | "pick" | "manage" | "conflict">("ready");
  const [selected, setSelected] = useState<string[]>(() => initialSelection(props.wallets.map((wallet) => wallet.id), props.activeId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [heldProofs, setHeldProofs] = useState<{ address: string; signature: string }[]>([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmPrimary, setConfirmPrimary] = useState<string | null>(null);
  const seenHandoff = useRef<string | null>(null);

  async function load(nextToken: string) {
    const next = await client.account(nextToken);
    setAccount(next);
    return next;
  }

  useEffect(() => {
    let live = true;
    void readLinkSession().then(async (session) => {
      if (!live || !session) return;
      setToken(session.token);
      try {
        const next = await client.account(session.token);
        if (live) setAccount(next);
      } catch (error) {
        if (live) setMessage(error instanceof Error ? error.message : "Could not load Discord.");
      }
    });
    return () => {
      live = false;
    };
  }, [client]);

  const acceptHandoff = useCallback(
    async (code: string, state: string) => {
      const key = `${state}:${code}`;
      if (seenHandoff.current === key) return;
      seenHandoff.current = key;
      props.onHandoffConsumed();
      setBusy(true);
      setMessage("");
      try {
        const exchanged = await client.exchange(code, state);
        await saveLinkSession({ token: exchanged.token, expiresAt: exchanged.expiresAt });
        setToken(exchanged.token);
        await load(exchanged.token);
        setSelected(initialSelection(props.wallets.map((wallet) => wallet.id), props.activeId));
        setPhase("pick");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Discord did not connect.");
      } finally {
        setBusy(false);
      }
    },
    [client, props],
  );

  useEffect(() => {
    if (!props.handoff) return;
    void acceptHandoff(props.handoff.code, props.handoff.state);
  }, [acceptHandoff, props.handoff]);

  const linked = (account?.addresses ?? []).map((row) => row.address);
  const selection = linkSelection({
    selectedIds: selected,
    wallets: props.wallets,
    linked,
    remaining: account?.remaining ?? 4,
  });

  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const returnUrl = createURL("discord");
      const started = await client.start(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(started.authorizeUrl, returnUrl);
      if (result.type !== "success") return;
      const handoff = identityCodeFromLink(result.url);
      if (!handoff) {
        setMessage("KNOAD could not read the return from Discord.");
        return;
      }
      await acceptHandoff(handoff.code, handoff.state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open Discord.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(proofs: { address: string; signature: string }[], confirmUnverified: boolean) {
    if (!token) return;
    try {
      await client.confirm(token, proofs, confirmUnverified);
      await load(token);
      setHeldProofs([]);
      setPhase("ready");
      setMessage(LINK_COPY.success);
    } catch (error) {
      if (error instanceof IdentityRequestError && error.code === "conflict_unverified") {
        setHeldProofs(proofs);
        setPhase("conflict");
        setMessage(error.message);
        return;
      }
      const text = error instanceof Error ? error.message : "Could not link these wallets.";
      setMessage(staysUnlinked(text) ? LINK_COPY.notOnChain : text);
    }
  }

  async function linkSelected() {
    if (!token || !selection.canConfirm) return;
    setBusy(true);
    setMessage("");
    try {
      const chosen = props.wallets.filter((wallet) => selected.includes(wallet.id));
      const challenges = await client.challenge(
        token,
        chosen.map((wallet) => wallet.address),
        DEFAULT_CHAIN_ID,
      );
      const proofs: { address: string; signature: string }[] = [];
      const skipped: string[] = [];
      for (const challenge of challenges) {
        const wallet = chosen.find((item) => item.address.toLowerCase() === challenge.address.toLowerCase());
        if (!wallet) continue;
        const approved = await props.onApprove(LINK_COPY.verifyNote);
        if (!approved) continue;
        try {
          const signature = await props.onSign(wallet.id, challenge.message);
          if (signature.toLowerCase().endsWith(ERC6492_MARK)) {
            skipped.push(shortAddress(challenge.address));
            continue;
          }
          proofs.push({ address: challenge.address, signature });
        } catch (error) {
          const text = error instanceof Error ? error.message : "";
          if (staysUnlinked(text)) skipped.push(shortAddress(challenge.address));
          else throw error;
        }
      }
      if (skipped.length > 0) setMessage(`${skipped.join(", ")}. ${LINK_COPY.notOnChain}`);
      if (proofs.length === 0) return;
      await submit(proofs, false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not link these wallets.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!token) return;
    setBusy(true);
    try {
      await client.disconnect(token);
      await clearLinkSession();
      setToken(null);
      setAccount(null);
      setConfirmDisconnect(false);
      setPhase("ready");
      setMessage(LINK_COPY.disconnected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect Discord.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(address: string, primary: boolean) {
    if (!token) return;
    if (primary && confirmPrimary !== address) {
      setConfirmPrimary(address);
      return;
    }
    setBusy(true);
    try {
      await client.unlink(token, address, primary);
      setConfirmPrimary(null);
      await load(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove that wallet.");
    } finally {
      setBusy(false);
    }
  }

  const profile = account?.profile;
  const many = props.wallets.length > 1;
  const phoneHasUnlinked = props.wallets.some(
    (wallet) => !linked.some((address) => address.toLowerCase() === wallet.address.toLowerCase()),
  );

  function openVerify() {
    setSelected(initialSelection(props.wallets.map((wallet) => wallet.id), props.activeId));
    setConfirmPrimary(null);
    setMessage("");
    setPhase("pick");
  }

  async function copyAddress(address: string) {
    await Clipboard.setStringAsync(address);
    setCopied(address);
  }

  return (
    <View style={styles.wrap}>
      <PageTitle title={LINK_COPY.title} subtitle={LINK_COPY.subtitle} />
      {phase === "conflict" ? (
        <Card style={styles.panel}>
          <Text style={styles.body}>{message}</Text>
          <PrimaryButton
            label="Move the unverified wallet"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void submit(heldProofs, true).finally(() => setBusy(false));
            }}
          />
          <OutlineButton label="Leave it" onPress={() => setPhase("pick")} />
        </Card>
      ) : null}
      {phase === "pick" ? (
        <Card style={styles.panel}>
          <Text style={styles.kicker}>{many ? LINK_COPY.walletsOnPhone : LINK_COPY.walletOnPhone}</Text>
          <Text style={styles.title}>{many ? LINK_COPY.verifyTitlePlural : LINK_COPY.verifyTitle}</Text>
          <Text style={styles.body}>{many ? LINK_COPY.verifyBodyPlural : LINK_COPY.verifyBody}</Text>
          {props.wallets.map((wallet) => {
            const on = selected.includes(wallet.id);
            const body = (
              <View style={styles.copy}>
                <Text style={styles.row}>{many ? `${on ? "●" : "○"} ${wallet.name}` : wallet.name}</Text>
                <Text style={styles.meta}>{shortAddress(wallet.address)}</Text>
              </View>
            );
            if (!many) return <View key={wallet.id}>{body}</View>;
            return (
              <Pressable
                key={wallet.id}
                onPress={() =>
                  setSelected((current) => (current.includes(wallet.id) ? current.filter((id) => id !== wallet.id) : [...current, wallet.id]))
                }
                style={styles.choice}
              >
                {body}
              </Pressable>
            );
          })}
          <Text style={styles.body}>{LINK_COPY.verifyNote}</Text>
          {selection.reason ? <Text style={styles.body}>{selection.reason}</Text> : null}
          <PrimaryButton
            label={many ? LINK_COPY.linkMany : LINK_COPY.linkOne}
            disabled={busy || !selection.canConfirm}
            onPress={() => void linkSelected()}
          />
        </Card>
      ) : null}
      {phase === "manage" && profile ? (
        <Card style={styles.panel}>
          <Text style={styles.title}>{LINK_COPY.manage}</Text>
          <View style={styles.list}>
            {(account?.addresses ?? []).map((row) => (
              <View key={row.address} style={styles.addressRow}>
                <Text style={styles.address}>{shortAddress(row.checksum)}</Text>
                <View style={styles.trailing}>
                  <Text style={styles.role}>{row.role === "primary" ? LINK_COPY.main : LINK_COPY.alternative}</Text>
                  <Text onPress={() => void copyAddress(row.checksum)} style={styles.link}>
                    {copied === row.checksum ? LINK_COPY.copied : LINK_COPY.copy}
                  </Text>
                  {row.verifiedByApp || row.role === "secondary" ? (
                    <Text onPress={() => void remove(row.address, row.role === "primary")} style={styles.link}>
                      {confirmPrimary === row.address ? LINK_COPY.confirmRemove : LINK_COPY.remove}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
          {phoneHasUnlinked ? (
            <View style={styles.actions}>
              <OutlineButton label={many ? LINK_COPY.linkMany : LINK_COPY.linkOne} onPress={openVerify} />
            </View>
          ) : null}
        </Card>
      ) : null}
      {phase === "ready" && profile ? (
        <Card style={styles.panel}>
          <View style={styles.identity}>
            {profile.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} /> : null}
            <View style={styles.copy}>
              <Text style={styles.title}>{profile.displayName}</Text>
              <Text style={styles.meta}>{LINK_COPY.discordConnected}</Text>
            </View>
          </View>
          <View style={styles.list}>
            <Text style={styles.sectionTitle}>{`${LINK_COPY.linkedWallets} ${account?.addresses.length ?? 0}`}</Text>
            {(account?.addresses ?? []).map((row) => (
              <View key={row.address} style={styles.addressRow}>
                <Text style={styles.address}>{shortAddress(row.checksum)}</Text>
                <Text style={styles.role}>{row.role === "primary" ? LINK_COPY.main : LINK_COPY.alternative}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.body}>{LINK_COPY.footnote}</Text>
          <View style={styles.actions}>
            <OutlineButton label={LINK_COPY.manage} onPress={() => setPhase("manage")} />
            {confirmDisconnect ? (
              <PrimaryButton label={LINK_COPY.disconnect} disabled={busy} onPress={() => void disconnect()} />
            ) : (
              <OutlineButton label={LINK_COPY.disconnect} tone="danger" onPress={() => setConfirmDisconnect(true)} />
            )}
            {confirmDisconnect ? <Text style={styles.body}>{LINK_COPY.disconnectBody}</Text> : null}
          </View>
        </Card>
      ) : null}
      {phase === "ready" && !profile ? (
        <Card style={styles.panel}>
          <Text style={styles.body}>{LINK_COPY.connectBody}</Text>
          <Text style={styles.body}>{LINK_COPY.reassurance}</Text>
          <PrimaryButton label={LINK_COPY.continue} disabled={busy} onPress={() => void connect()} />
        </Card>
      ) : null}
      {message && phase !== "conflict" ? <Text style={styles.body}>{message}</Text> : null}
      <OutlineButton
        label="Back"
        onPress={() => {
          if (profile && (phase === "pick" || phase === "manage")) {
            setPhase("ready");
            setConfirmPrimary(null);
            setConfirmDisconnect(false);
            return;
          }
          props.onBack();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  panel: { gap: 22 },
  identity: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.inset },
  copy: { flex: 1, gap: 4 },
  list: { gap: 2 },
  title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: theme.type.card },
  sectionTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: theme.type.card, marginBottom: 8 },
  row: { color: theme.text, fontFamily: theme.font.medium, fontSize: theme.type.row },
  address: { color: theme.text, fontFamily: theme.font.medium, fontSize: theme.type.row, flex: 1 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 20 },
  meta: { color: theme.textDim, fontFamily: theme.font.regular, fontSize: theme.type.caption },
  role: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: theme.type.caption },
  kicker: { color: theme.textDim, fontFamily: theme.font.semibold, fontSize: theme.type.caption, letterSpacing: 0.4 },
  link: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: theme.type.caption },
  choice: { gap: 2, paddingVertical: 8 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40 },
  trailing: { flexDirection: "row", alignItems: "center", gap: 14 },
  actions: { gap: 12 },
});
