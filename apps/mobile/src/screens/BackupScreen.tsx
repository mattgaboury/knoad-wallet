import { Image, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { Card, PageTitle, PrimaryButton, wordmark } from "../ui/chrome";
import { Field } from "../ui/Field";

export function BackupScreen(props: {
  mnemonic: string;
  checkIndex: number;
  checkWord: string;
  message: string;
  error: boolean;
  busy: boolean;
  onCheckWord: (value: string) => void;
  onConfirm: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Image source={wordmark} style={styles.logo} accessibilityLabel="knoad" />
      <PageTitle title="Save your words" subtitle="Write these down. They are shown once." />
      <Card>
        <Text style={styles.secret}>{props.mnemonic}</Text>
      </Card>
      <Field label={`Type word ${props.checkIndex + 1}`} value={props.checkWord} onChange={props.onCheckWord} onSubmit={props.onConfirm} />
      <PrimaryButton label={props.busy ? "Saving" : "I wrote it down"} onPress={props.onConfirm} disabled={props.busy} />
      {props.message ? <Text style={props.error ? styles.error : styles.status}>{props.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingTop: 12 },
  logo: { width: 150, height: 28, resizeMode: "contain" },
  secret: { color: theme.text, fontFamily: theme.font.regular, fontSize: 16, lineHeight: 24 },
  status: { color: theme.text, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
  error: { color: theme.danger, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
});
