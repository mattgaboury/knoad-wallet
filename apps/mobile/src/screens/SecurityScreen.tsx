import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { daysAgo, hostOf, verifiedDate } from "../format";
import type { SavedSite } from "../sites";
import { theme } from "../theme";
import type { PhoneChainView } from "../useWallet";
import { GlowCard, GlowIcon, OutlineButton, PageTitle, StatusDot } from "../ui/chrome";
import { Icon } from "../ui/icons";
import { ChainMark } from "../ui/marks";

const VERIFIED = "knoad.recovery.verified";

export function SecurityScreen(props: {
  views: PhoneChainView[];
  scanning?: boolean;
  pendingIds: number[];
  sites: SavedSite[];
  onRecover: () => void;
  onDisconnect: (topic: string) => void;
}) {
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);
  const [approvals, setApprovals] = useState(false);
  useEffect(() => {
    void AsyncStorage.getItem(VERIFIED).then((value) => setVerifiedAt(value ? Number(value) : null));
  }, []);

  const deployed = props.views.filter((view) => view.checked && view.deployed);
  const allChecked = props.views.every((view) => view.checked);
  const allProtected = deployed.length > 0 && deployed.every((view) => statusOf(view, props.pendingIds).label === "Protected");
  const fresh = allChecked && deployed.length === 0 && props.pendingIds.length === 0;
  const calm = props.scanning || allProtected || fresh;
  const headline = props.scanning ? "Checking security" : allProtected ? "Protection active" : fresh ? "Ready to receive" : "Check needed";

  return (
    <View style={styles.wrap}>
      <PageTitle title="Security Center" subtitle="Dynamic key protection for a safer web3." />
      <GlowCard tone={calm ? "mint" : "warning"}>
        <View style={styles.head}>
          <GlowIcon name="shieldCheck" tone={calm ? "mint" : "warning"} />
          <View style={styles.copy}>
            <View style={styles.inline}>
              <Text style={styles.cardTitle}>{headline}</Text>
              <View style={styles.protectChip}>
                <Text style={styles.protectText}>KNOAD PROTECTION</Text>
              </View>
            </View>
            <Text style={styles.body}>Each chain uses a separate spending key. Your assets stay safer by design.</Text>
          </View>
        </View>
        <View style={styles.grid}>
          {props.views.map((view) => {
            const status = props.scanning ? { label: "Checking", tone: "dim" as const } : statusOf(view, props.pendingIds);
            return (
              <View key={view.chainId} style={styles.cell}>
                <ChainMark chainId={view.chainId} size={28} />
                <View style={styles.cellCopy}>
                  <Text style={styles.cellName} numberOfLines={1}>
                    {view.name}
                  </Text>
                  <StatusDot label={status.label} tone={status.tone} />
                </View>
              </View>
            );
          })}
        </View>
      </GlowCard>

      <Pressable onPress={props.onRecover} style={styles.card}>
        <View style={styles.head}>
          <View style={styles.lead}>
            <Icon name="rotate" color={theme.mint} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>Recovery</Text>
            <Text style={styles.body}>Restore access to your wallet if you lose your device or spending keys.</Text>
          </View>
          <Icon name="chevronRight" size={18} color={theme.textDim} />
        </View>
        <View style={styles.inset}>
          <Icon name="key" size={16} color={theme.mint} />
          <View style={styles.copy}>
            <Text style={styles.rowTitle}>{verifiedAt ? "Recovery method set" : "Recovery words set"}</Text>
            <Text style={styles.body}>{verifiedAt ? `Last verified ${verifiedDate(verifiedAt)}` : "Confirmed on this phone."}</Text>
          </View>
          <View style={styles.active}>
            <Text style={styles.activeText}>Active</Text>
          </View>
        </View>
      </Pressable>

      <Pressable onPress={() => setApprovals((current) => !current)} style={styles.card}>
        <View style={styles.head}>
          <View style={styles.lead}>
            <Icon name="permissions" color={theme.mint} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>Approvals & Permissions</Text>
            <Text style={styles.body}>Manage token, NFT and dApp permissions across all chains.</Text>
          </View>
          <Icon name="chevronRight" size={18} color={theme.textDim} />
        </View>
        <View style={styles.counts}>
          <Count value="—" label="Token approvals" caption="Not checked" />
          <Count value="—" label="NFT permissions" caption="Not checked" />
          <Count value={String(props.sites.length)} label="dApp permissions" caption="Connected" />
        </View>
        {approvals ? (
          <Text style={styles.body}>Disconnecting a site does not revoke token approvals. Token and NFT allowances are not scanned yet.</Text>
        ) : null}
      </Pressable>

      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.lead}>
            <Icon name="link" color={theme.mint} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>Connected Sites</Text>
            <Text style={styles.body}>Manage dApps you've connected to.</Text>
          </View>
        </View>
        {props.sites.length === 0 ? <Text style={styles.body}>No sites connected.</Text> : null}
        {props.sites.map((site) => (
          <View key={site.topic} style={styles.site}>
            <SiteIcon site={site} />
            <View style={styles.copy}>
              <Text style={styles.rowTitle}>{site.name}</Text>
              <Text style={styles.body}>{`Connected · ${daysAgo(site.connectedAt)}`}</Text>
            </View>
            <OutlineButton label="Disconnect" tone="danger" onPress={() => props.onDisconnect(site.topic)} />
          </View>
        ))}
      </View>
    </View>
  );
}

function statusOf(view: PhoneChainView, pendingIds: number[]): { label: string; tone: "mint" | "warn" | "danger" | "dim" } {
  if (!view.checked) return { label: "Unable to check", tone: "warn" };
  if (pendingIds.includes(view.chainId)) return { label: "Change pending", tone: "warn" };
  if (!view.deployed) return { label: "Not deployed", tone: "dim" };
  if (view.needsWords || !view.canSpend) return { label: "Recovery required", tone: "danger" };
  return { label: "Protected", tone: "mint" };
}

function Count(props: { value: string; label: string; caption: string }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countValue}>{props.value}</Text>
      <Text style={styles.countLabel}>{props.label}</Text>
      <Text style={styles.body}>{props.caption}</Text>
    </View>
  );
}

function SiteIcon(props: { site: { name: string; url: string; icon?: string } }) {
  const [failed, setFailed] = useState(false);
  const source = props.site.icon || `https://www.google.com/s2/favicons?domain=${hostOf(props.site.url)}&sz=64`;
  if (failed || !props.site.url) {
    return (
      <View style={styles.monogram}>
        <Text style={styles.monoText}>{props.site.name.slice(0, 1).toUpperCase()}</Text>
      </View>
    );
  }
  return <Image source={{ uri: source }} style={styles.favicon} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 12 },
  head: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  copy: { flex: 1, gap: 4 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 17 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 18 },
  protectChip: { borderWidth: 1, borderColor: theme.mint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  protectText: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 10, letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  cell: {
    width: "48.5%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.inset,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  cellCopy: { flex: 1, minWidth: 0, gap: 2 },
  cellName: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13 },
  lead: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.borderMint,
    alignItems: "center",
    justifyContent: "center",
  },
  inset: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.inset, borderRadius: theme.radius.md, padding: 12 },
  rowTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  active: { borderWidth: 1, borderColor: theme.mint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  activeText: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 12 },
  counts: { flexDirection: "row", gap: 8 },
  count: { flex: 1, backgroundColor: theme.inset, borderRadius: theme.radius.md, padding: 10, gap: 2 },
  countValue: { color: theme.text, fontFamily: theme.font.bold, fontSize: 22 },
  countLabel: { color: theme.text, fontFamily: theme.font.medium, fontSize: 12 },
  site: { flexDirection: "row", alignItems: "center", gap: 10 },
  favicon: { width: 36, height: 36, borderRadius: 18 },
  monogram: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.elevated, alignItems: "center", justifyContent: "center" },
  monoText: { color: theme.mint, fontFamily: theme.font.bold, fontSize: 16 },
});
