import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { Icon, type IconName } from "./icons";

export const wordmark = require("../../../../packages/brand/assets/knoadTitleTransWhite.png");

export function Screen(props: {
  children: ReactNode;
  scroll?: boolean;
  bleed?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  refresh?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scroll = props.scroll !== false;
  const body = props.bleed ? styles.bleed : styles.scroll;
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {props.header}
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={body}
          keyboardShouldPersistTaps="always"
          refreshControl={props.refresh as never}
        >
          {props.children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, body]}>{props.children}</View>
      )}
      {props.footer}
    </View>
  );
}

export function AppHeader(props: { onScan: () => void; onBell: () => void; alert?: boolean }) {
  return (
    <View style={styles.header}>
      <Image source={wordmark} style={styles.logo} accessibilityLabel="knoad" />
      <View style={styles.headerActions}>
        <Pressable onPress={props.onScan} hitSlop={8} accessibilityLabel="Scan">
          <Icon name="scan" size={22} color={theme.text} />
        </Pressable>
        <IconButton name="bell" onPress={props.onBell} badge={props.alert} label="Alerts" />
      </View>
    </View>
  );
}

export function PageTitle(props: { title: string; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.pageTitle}>{props.title}</Text>
      {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
    </View>
  );
}

export type TabId = "wallet" | "activity" | "security" | "browser" | "settings";

const TABS: { id: TabId; label: string; icon: IconName; active: IconName }[] = [
  { id: "wallet", label: "Wallet", icon: "wallet", active: "walletFill" },
  { id: "activity", label: "Activity", icon: "activity", active: "activity" },
  { id: "security", label: "Security", icon: "shield", active: "shield" },
  { id: "browser", label: "Browser", icon: "browser", active: "browser" },
  { id: "settings", label: "Settings", icon: "gear", active: "gear" },
];

export function TabBar(props: { active: TabId; onChange: (tab: TabId) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {TABS.map((tab) => {
        const on = tab.id === props.active;
        return (
          <Pressable key={tab.id} style={styles.tab} onPress={() => props.onChange(tab.id)} accessibilityRole="button">
            <View style={[styles.tabPill, on ? styles.tabPillOn : null]}>
              <Icon name={on ? tab.active : tab.icon} size={22} color={on ? theme.mint : theme.textMuted} />
            </View>
            <Text style={[styles.tabLabel, on ? styles.tabLabelOn : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function GlowCard(props: { children: ReactNode; tone?: "mint" | "warning" }) {
  const warning = props.tone === "warning";
  return (
    <View style={[styles.card, styles.glow, warning ? styles.glowWarn : null]}>
      <LinearGradient
        colors={[warning ? theme.warningTint : theme.mintTint, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {props.children}
    </View>
  );
}

export function IconButton(props: { name: IconName; onPress?: () => void; badge?: boolean; label: string; color?: string }) {
  return (
    <Pressable onPress={props.onPress} accessibilityLabel={props.label} style={styles.iconButton}>
      <Icon name={props.name} size={18} color={props.color ?? theme.text} />
      {props.badge ? <View style={styles.badge} /> : null}
    </Pressable>
  );
}

export function GlowIcon(props: { name: IconName; tone?: "mint" | "warning" }) {
  const warning = props.tone === "warning";
  const color = warning ? theme.warning : theme.mint;
  return (
    <View style={[styles.glowIcon, { borderColor: color, backgroundColor: warning ? theme.warningTint : theme.mintTint }]}>
      <Icon name={props.name} size={22} color={color} />
    </View>
  );
}

export function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.primary, pressed && !props.disabled ? styles.pressed : null, props.disabled ? styles.disabled : null]}
    >
      {props.icon ? <Icon name={props.icon} size={18} color={theme.onMint} /> : null}
      <Text style={styles.primaryLabel}>{props.label}</Text>
    </Pressable>
  );
}

export function OutlineButton(props: { label: string; onPress: () => void; tone?: "mint" | "danger"; icon?: IconName; disabled?: boolean }) {
  const danger = props.tone === "danger";
  const color = danger ? theme.danger : theme.mint;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.outline,
        { borderColor: color },
        pressed && !props.disabled ? styles.pressed : null,
        props.disabled ? styles.disabled : null,
      ]}
    >
      {props.icon ? <Icon name={props.icon} size={16} color={color} /> : null}
      <Text style={[styles.outlineLabel, { color }]}>{props.label}</Text>
    </Pressable>
  );
}

export function GhostButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={props.disabled} onPress={props.onPress} style={styles.ghost}>
      <Text style={styles.ghostLabel}>{props.label}</Text>
    </Pressable>
  );
}

export function Chip(props: { label: string; tone?: "mint" | "warn" | "danger" | "info" | "dim" }) {
  const tone = props.tone ?? "mint";
  const color = tone === "warn" ? theme.warning : tone === "danger" ? theme.danger : tone === "info" ? theme.info : tone === "dim" ? theme.textMuted : theme.mint;
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Text style={[styles.chipText, { color }]}>{props.label}</Text>
    </View>
  );
}

export function StatusDot(props: { label: string; tone?: "mint" | "warn" | "danger" | "dim" }) {
  const tone = props.tone ?? "mint";
  const color = tone === "warn" ? theme.warning : tone === "danger" ? theme.danger : tone === "dim" ? theme.textDim : theme.mint;
  return (
    <View style={styles.statusRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]} numberOfLines={1}>
        {props.label}
      </Text>
    </View>
  );
}

export function Toggle(props: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.on }}
      onPress={() => props.onChange(!props.on)}
      style={[styles.toggle, props.on ? styles.toggleOn : null]}
    >
      <View style={[styles.knob, props.on ? styles.knobOn : null]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: theme.space.gutter, paddingBottom: 28, gap: theme.space.cardGap },
  bleed: { flex: 1 },
  header: {
    paddingHorizontal: theme.space.gutter,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: { width: 150, height: 28, resizeMode: "contain" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  titleBlock: { gap: 4, marginBottom: 4 },
  pageTitle: { color: theme.text, fontFamily: theme.font.bold, fontSize: theme.type.page, letterSpacing: -0.4 },
  subtitle: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 20 },
  tabBar: {
    flexDirection: "row",
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: "center", gap: 2 },
  tabPill: { width: 56, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tabPillOn: { backgroundColor: theme.mintTint },
  tabLabel: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12 },
  tabLabelOn: { color: theme.mint },
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: theme.space.card,
    overflow: "hidden",
  },
  glow: { borderColor: theme.borderMint },
  glowWarn: { borderColor: "rgba(242,185,75,0.55)" },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 7,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.mint,
  },
  glowIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    height: 56,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.mint,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryLabel: { color: theme.onMint, fontFamily: theme.font.bold, fontSize: 16 },
  pressed: { backgroundColor: theme.mintPressed, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  outline: {
    minHeight: 44,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 14,
    backgroundColor: "transparent",
  },
  outlineLabel: { fontFamily: theme.font.semibold, fontSize: 14 },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghostLabel: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 15 },
  chip: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  chipText: { fontFamily: theme.font.semibold, fontSize: theme.type.chip, letterSpacing: 0.6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontFamily: theme.font.medium, fontSize: 11, flexShrink: 1 },
  toggle: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
    justifyContent: "center",
    padding: 3,
  },
  toggleOn: { backgroundColor: theme.mint, borderColor: theme.mint },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.textMuted },
  knobOn: { backgroundColor: theme.onMint, alignSelf: "flex-end" },
});
