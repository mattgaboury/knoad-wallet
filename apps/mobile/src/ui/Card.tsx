import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { theme } from "../theme";

export function Card(props: { children: ReactNode }) {
  return <View style={styles.card}>{props.children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: theme.space.card,
  },
});
