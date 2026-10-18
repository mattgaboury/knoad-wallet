import { Image, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { GhostButton, PageTitle, PrimaryButton, wordmark } from "../ui/chrome";
import { Field } from "../ui/Field";

export function CreateScreen(props: {
  password: string;
  message: string;
  hasVault: boolean;
  onPassword: (value: string) => void;
  onCreate: () => void;
  onRecover: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Image source={wordmark} style={styles.logo} accessibilityLabel="knoad" />
      <PageTitle title="Create wallet" subtitle="The password only unlocks this phone. The 24 words are your way back, and they are not saved here." />
      <Field label="Phone password" value={props.password} onChange={props.onPassword} onSubmit={props.onCreate} secure />
      <PrimaryButton label="Create wallet" onPress={props.onCreate} />
      <GhostButton label="I have 24 words" onPress={props.onRecover} />
      {props.hasVault ? <GhostButton label="Back" onPress={props.onBack} /> : null}
      {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingTop: 12 },
  logo: { width: 150, height: 28, resizeMode: "contain" },
  message: { color: theme.danger, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
});
