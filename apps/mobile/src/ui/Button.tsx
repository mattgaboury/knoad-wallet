import { Pressable, StyleSheet, Text } from "react-native";
import type { ButtonVariant } from "@knoad/brand";
import { theme } from "../theme";

export function Button(props: { label: string; onPress: () => void; variant?: ButtonVariant; disabled?: boolean }) {
  const variant = props.variant ?? "primary";
  const danger = variant === "danger";
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.outline,
        danger ? styles.danger : null,
        variant === "ghost" ? styles.ghost : null,
        pressed && !props.disabled ? styles.pressed : null,
        props.disabled ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.label, primary ? styles.primaryLabel : danger ? styles.dangerLabel : styles.defaultLabel]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { marginTop: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "transparent", paddingVertical: 14, paddingHorizontal: 14 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  primary: { backgroundColor: theme.mint },
  outline: { backgroundColor: "transparent", borderColor: theme.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { borderColor: theme.danger },
  label: { textAlign: "center", fontFamily: theme.font.semibold, fontSize: 15 },
  primaryLabel: { color: theme.onMint },
  defaultLabel: { color: theme.text },
  dangerLabel: { color: theme.danger },
});
