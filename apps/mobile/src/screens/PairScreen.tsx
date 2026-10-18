import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { theme } from "../theme";
import { GhostButton, PageTitle, PrimaryButton } from "../ui/chrome";
import { Field } from "../ui/Field";

export function PairScreen(props: {
  uri: string;
  message: string;
  busy: boolean;
  onUri: (value: string) => void;
  paired: boolean;
  onPair: (uri?: string) => void;
  onDisconnect: () => void;
  onBack: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function scan() {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    setScanning(true);
  }

  return (
    <View style={styles.wrap}>
      <PageTitle title="Connect" subtitle="The site sees your address only." />
      <Field label="Connection code" value={props.uri} onChange={props.onUri} onSubmit={() => props.onPair()} />
      {scanning ? (
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (!data.startsWith("wc:")) return;
            props.onUri(data);
            setScanning(false);
            props.onPair(data);
          }}
        />
      ) : null}
      <Pressable onPress={() => (scanning ? setScanning(false) : void scan())}>
        <Text style={styles.link}>{scanning ? "Stop scanning" : "Scan code"}</Text>
      </Pressable>
      <PrimaryButton label={props.busy ? "Connecting" : "Connect"} onPress={() => props.onPair()} disabled={props.busy} />
      {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
      {props.paired ? <GhostButton label="Disconnect" onPress={props.onDisconnect} /> : null}
      <GhostButton label="Back" onPress={props.onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  camera: { height: 240, borderRadius: theme.radius.lg, overflow: "hidden" },
  link: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 15 },
  message: { color: theme.text, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
});
