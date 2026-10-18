import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatUnits } from "@knoad/wallet-core";
import { trimAmount, usd } from "../format";
import type { Spot } from "../prices";
import { isTestnet, theme } from "../theme";
import type { Holding } from "../useWallet";
import { ActionTile } from "../ui/bits";
import { PageTitle } from "../ui/chrome";
import { Icon } from "../ui/icons";
import { TokenMark } from "../ui/marks";

export function AssetScreen(props: {
  symbol: string;
  rows: Holding[];
  spot: Spot | null;
  onSend: () => void;
  onReceive: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Pressable onPress={props.onBack} style={styles.back} accessibilityLabel="Back">
        <Icon name="chevronLeft" size={22} color={theme.text} />
      </Pressable>
      <PageTitle title={props.symbol} subtitle="Balance on each chain that holds it." />
      {props.rows.map((row) => {
        const price = isTestnet(row.chainId) || !props.spot ? null : props.symbol === "USDC" ? props.spot.usdc : props.spot.eth;
        const fiat = price === null || row.unavailable ? null : Number(formatUnits(row.amount, row.decimals)) * price;
        return (
          <View key={row.key} style={styles.row}>
            <TokenMark symbol={row.symbol} size={36} />
            <View style={styles.copy}>
              <Text style={styles.name}>{row.chainName}</Text>
              <Text style={styles.meta}>{row.unavailable ? "Unavailable" : `${trimAmount(row.text)} ${row.symbol}`}</Text>
            </View>
            <Text style={styles.fiat}>{isTestnet(row.chainId) ? "Testnet" : fiat === null ? "—" : usd(fiat)}</Text>
          </View>
        );
      })}
      <View style={styles.actions}>
        <ActionTile icon="send" label="Send" onPress={props.onSend} />
        <ActionTile icon="receive" label="Receive" onPress={props.onReceive} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
  },
  copy: { flex: 1 },
  name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
  meta: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13, marginTop: 2 },
  fiat: { color: theme.text, fontFamily: theme.font.medium, fontSize: 14 },
  actions: { flexDirection: "row", gap: 10 },
});
