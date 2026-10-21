import { useEffect, useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { CHAINS, PREPARED_CHAINS } from "@knoad/wallet-core";
import { probeChainLinks, probeQuote, type ChainLink } from "../chain";
import { COINGECKO_API_KEY, COMMERCE_SUBMIT_ENABLED, WALLETCONNECT_PROJECT_ID } from "../config";
import { createIdentityClient } from "../identity/client";
import { LINK_COPY } from "../identity/copy";
import { readLinkSession } from "../identity/session";
import { theme } from "../theme";
import { PageTitle, PrimaryButton, Toggle } from "../ui/chrome";
import { ChainMark } from "../ui/marks";

export function SettingsScreen(props: {
  bio: boolean;
  auto: boolean;
  onBio: (next: boolean) => void;
  onAuto: (next: boolean) => void;
  onPassword: (next: string) => Promise<void>;
  onPair: () => void;
  onSites: () => void;
  onLegal: () => void;
  linkEnabled?: boolean;
  apiUrl?: string;
  onConnected?: () => void;
  message: string;
}) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [links, setLinks] = useState<ChainLink[] | null>(null);
  const [quotes, setQuotes] = useState<"ready" | "unreachable" | "notset" | null>(null);
  const [discordName, setDiscordName] = useState<string | null>(null);
  const [discordLinked, setDiscordLinked] = useState(false);
  const version = Constants.expoConfig?.version ?? "0.1.0";

  useEffect(() => {
    let live = true;
    void probeChainLinks().then((nextLinks) => {
      if (live) setLinks(nextLinks);
    });
    void probeQuote().then((next) => {
      if (live) setQuotes(next);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!props.linkEnabled || !props.apiUrl) return;
    let live = true;
    const client = createIdentityClient(props.apiUrl);
    void readLinkSession().then(async (session) => {
      if (!live || !session) return;
      try {
        const account = await client.account(session.token);
        if (!live) return;
        setDiscordLinked(Boolean(account.profile));
        setDiscordName(account.profile?.displayName || null);
      } catch {
        if (live) {
          setDiscordLinked(false);
          setDiscordName(null);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [props.apiUrl, props.linkEnabled]);

  return (
    <View style={styles.wrap}>
      <PageTitle title="Settings" subtitle="Controls that work on this phone." />
      <Section title="This phone">
        {CHAINS.map((chain) => {
          const link = links?.find((item) => item.chainId === chain.chainId);
          return (
            <View key={chain.chainId} style={styles.switchRow}>
              <ChainMark chainId={chain.chainId} size={22} />
              <View style={styles.copy}>
                <Text style={styles.row}>{chain.name}</Text>
                <Text style={styles.meta}>
                  {link ? `Read ${endpointLabel(link.read)} · Send ${endpointLabel(link.send)}` : "Checking"}
                </Text>
              </View>
            </View>
          );
        })}
        <Status label="Prices" value={COINGECKO_API_KEY ? "Demo key set" : "Add a CoinGecko demo key"} />
        <Status label="WalletConnect" value={WALLETCONNECT_PROJECT_ID ? "Project id set" : "Add a project id"} />
        <Status label="Quotes" value={quoteLabel(quotes)} />
        <Status label="Swap signing" value={COMMERCE_SUBMIT_ENABLED ? "On" : "Off"} />
      </Section>
      <Section title="Not ready">
        {PREPARED_CHAINS.map((chain) => (
          <View key={chain.chainId} style={styles.switchRow}>
            <ChainMark chainId={chain.chainId} size={22} />
            <View style={styles.copy}>
              <Text style={styles.row}>{chain.name}</Text>
              <Text style={styles.hint}>{`${chain.native.symbol} · Not ready`}</Text>
            </View>
          </View>
        ))}
      </Section>
      <Section title="Security">
        <Row label="Change password" onPress={() => setOpen((current) => !current)} />
        {open ? (
          <View style={styles.form}>
            <Field placeholder="New phone password" value={next} onChange={setNext} />
            <Field placeholder="Repeat the password" value={again} onChange={setAgain} />
            <PrimaryButton
              label="Save password"
              onPress={() => {
                if (next !== again) return;
                void props.onPassword(next).then(() => {
                  setNext("");
                  setAgain("");
                  setOpen(false);
                });
              }}
              disabled={!next || next !== again}
            />
          </View>
        ) : null}
        <View style={styles.switchRow}>
          <Text style={styles.row}>Biometric unlock</Text>
          <Toggle on={props.bio} onChange={props.onBio} label="Biometric unlock" />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.copy}>
            <Text style={styles.row}>Pending sends</Text>
            <Text style={styles.hint}>After 15 minutes, prepare a higher-fee replacement. You still approve it.</Text>
          </View>
          <Toggle on={props.auto} onChange={props.onAuto} label="Pending sends" />
        </View>
      </Section>
      {props.linkEnabled && props.onConnected ? (
        <Section title={LINK_COPY.title}>
          <Text style={styles.hint}>{LINK_COPY.settingsLead}</Text>
          <AccountRow
            label={discordName ?? "Discord"}
            detail={discordLinked ? LINK_COPY.settingsConnected : LINK_COPY.settingsConnect}
            onPress={props.onConnected}
          />
        </Section>
      ) : null}
      <Section title="Connections">
        <Row label="Connect a site" onPress={props.onPair} />
        <Row label="Connected sites" onPress={props.onSites} />
      </Section>
      <Section title="About">
        <Text style={styles.meta}>{`Version ${version}`}</Text>
        <Row label="knoad.io" onPress={() => void Linking.openURL("https://knoad.io")} />
        <Row label="Terms and privacy" onPress={props.onLegal} />
      </Section>
      {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
    </View>
  );
}

function quoteLabel(value: "ready" | "unreachable" | "notset" | null): string {
  if (value === "ready") return "Ready";
  if (value === "unreachable") return "Unreachable";
  if (value === "notset") return "Set EXPO_PUBLIC_KNOAD_QUOTE_URL";
  return "Checking";
}

function endpointLabel(value: "ready" | "unreachable" | "notset" | "off"): string {
  if (value === "ready") return "Ready";
  if (value === "notset") return "Not set";
  if (value === "off") return "EntryPoint 0.9 off";
  return "Unreachable";
}

function Status(props: { label: string; value: string }) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.row}>{props.label}</Text>
      <Text style={styles.meta}>{props.value}</Text>
    </View>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{props.title}</Text>
      {props.children}
    </View>
  );
}

function Row(props: { label: string; onPress: () => void }) {
  return (
    <Text onPress={props.onPress} style={styles.rowButton}>
      {props.label}
    </Text>
  );
}

function AccountRow(props: { label: string; detail: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.switchRow}>
      <Text style={styles.row}>{props.label}</Text>
      <Text style={styles.rowButton}>{props.detail}</Text>
    </Pressable>
  );
}

function Field(props: { placeholder: string; value: string; onChange: (value: string) => void; secure?: boolean }) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChange}
      placeholder={props.placeholder}
      placeholderTextColor={theme.textDim}
      secureTextEntry={props.secure !== false}
      autoCapitalize="none"
      autoCorrect={false}
      style={styles.input}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 12 },
  title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  row: { color: theme.text, fontFamily: theme.font.medium, fontSize: 15, flex: 1 },
  copy: { flex: 1, gap: 2 },
  hint: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 18 },
  rowButton: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 15 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  meta: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, flexShrink: 1, textAlign: "right" },
  form: { gap: 8 },
  input: { color: theme.text, backgroundColor: theme.inset, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.border, padding: 12, fontFamily: theme.font.regular, fontSize: 15 },
  message: { color: theme.text, fontFamily: theme.font.regular, fontSize: 14 },
});
