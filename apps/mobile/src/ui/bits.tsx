import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { theme } from "../theme";
import { Icon, type IconName } from "./icons";

export function Sparkline(props: { points: number[]; width?: number; height?: number; dim?: boolean }) {
  const width = props.width ?? 148;
  const height = props.height ?? 72;
  const source = props.points.length > 1 ? props.points : [0, 0];
  const min = Math.min(...source);
  const max = Math.max(...source);
  const span = max - min || 1;
  const step = width / Math.max(source.length - 1, 1);
  const line = source
    .map((value, index) => {
      const x = index * step;
      const y = height - 6 - ((value - min) / span) * (height - 12);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = props.dim ? theme.textDim : theme.mint;
  return (
    <Svg width={width} height={height}>
      <Polyline points={line} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={0.25} />
      <Polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function Identicon(props: { seed: string; size?: number }) {
  const size = props.size ?? 48;
  const cells = grid(props.seed);
  const cell = (size - 10) / 5;
  return (
    <View style={[styles.identicon, { width: size, height: size, borderRadius: size / 2 }]}>
      {cells.map((on, index) => (
        <View
          key={index}
          style={{
            width: cell,
            height: cell,
            margin: 1,
            borderRadius: 2,
            backgroundColor: on ? theme.mint : "transparent",
          }}
        />
      ))}
    </View>
  );
}

function grid(seed: string): boolean[] {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row += 1) {
    const bits: boolean[] = [];
    for (let col = 0; col < 3; col += 1) {
      hash = Math.imul(hash ^ (row * 3 + col + 1), 2246822519);
      bits.push((hash >>> 0) % 3 !== 0);
    }
    cells.push(...bits, bits[1], bits[0]);
  }
  return cells;
}

export function ActionTile(props: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.tile} accessibilityRole="button">
      <Icon name={props.icon} size={22} color={theme.mint} />
      <Text style={styles.tileLabel}>{props.label}</Text>
    </Pressable>
  );
}

export function Inset(props: { children: ReactNode }) {
  return <View style={styles.inset}>{props.children}</View>;
}

export function Hairline() {
  return <View style={styles.hairline} />;
}

const styles = StyleSheet.create({
  identicon: {
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    justifyContent: "center",
  },
  tile: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 92,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  tileLabel: { color: theme.text, fontFamily: theme.font.medium, fontSize: 13 },
  inset: {
    backgroundColor: theme.inset,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hairline: { height: 1, backgroundColor: theme.border, marginVertical: 8 },
});
