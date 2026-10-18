import { Share, StyleSheet, Text, Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { shortAddress } from "../format";
import { theme } from "../theme";
import { Card, GhostButton, OutlineButton, PageTitle } from "../ui/chrome";
import { Icon } from "../ui/icons";

export function ReceiveScreen(props: { address: string; chainName: string; onBack: () => void }) {
  async function copy() {
    await Clipboard.setStringAsync(props.address);
    void Haptics.selectionAsync().catch(() => undefined);
  }
  return (
    <View style={styles.wrap}>
      <Pressable onPress={props.onBack} style={styles.back} accessibilityLabel="Back">
        <Icon name="chevronLeft" size={24} color={theme.text} />
        <Text style={styles.backText}>Receive</Text>
      </Pressable>
      <PageTitle title="Receive" subtitle={`Same address on every EVM network. Selected: ${props.chainName}.`} />
      <Card>
        <View style={styles.qr}>
          <QRCode value={props.address} size={180} color={theme.text} backgroundColor={theme.card} />
        </View>
        <Text style={styles.address}>{props.address}</Text>
        <Text style={styles.short}>{shortAddress(props.address)}</Text>
      </Card>
      <OutlineButton label="Copy" icon="copy" onPress={() => void copy()} />
      <GhostButton label="Share" onPress={() => void Share.share({ message: props.address })} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  back: { flexDirection: "row", alignItems: "center", gap: 8 },
  backText: { color: theme.text, fontFamily: theme.font.bold, fontSize: 28 },
  qr: { alignItems: "center", paddingVertical: 12 },
  address: { color: theme.text, fontFamily: theme.font.regular, fontSize: 13, lineHeight: 20, textAlign: "center" },
  short: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 14, textAlign: "center", marginTop: 8 },
});
