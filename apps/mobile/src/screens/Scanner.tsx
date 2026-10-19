import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { isAddress } from "viem";
import { theme } from "../theme";

export function Scanner(props: { onAddress: (value: string) => void; onWalletConnect: (uri: string) => void; onClose: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const seenCode = useRef<string | null>(null);

  async function open() {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    setReady(true);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.page}>
        <Text style={styles.title}>Scan</Text>
        <Text style={styles.body}>Point at a connection code or an address.</Text>
        {ready ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (data.startsWith("wc:")) {
                if (seenCode.current) return;
                seenCode.current = data;
                props.onWalletConnect(data);
                return;
              }
              if (isAddress(data)) props.onAddress(data);
            }}
          />
        ) : (
          <Pressable onPress={() => void open()} style={styles.button}>
            <Text style={styles.buttonText}>Open camera</Text>
          </Pressable>
        )}
        <Pressable onPress={props.onClose}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg, padding: 24, gap: 16, justifyContent: "center" },
  title: { color: theme.text, fontFamily: theme.font.bold, fontSize: 28 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 15 },
  camera: { height: 320, borderRadius: 18, overflow: "hidden" },
  button: { height: 56, borderRadius: 999, backgroundColor: theme.mint, alignItems: "center", justifyContent: "center" },
  buttonText: { color: theme.onMint, fontFamily: theme.font.bold, fontSize: 16 },
  close: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 16, textAlign: "center" },
});
