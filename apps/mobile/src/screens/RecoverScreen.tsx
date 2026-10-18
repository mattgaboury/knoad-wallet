import { Image, StyleSheet, View } from "react-native";
import { GhostButton, PageTitle, wordmark } from "../ui/chrome";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { CutoffSheet, type CutoffRow } from "./CutoffSheet";

export function RecoverScreen(props: {
  mnemonic: string;
  password: string;
  rows: CutoffRow[] | null;
  kind: "spend" | "secure";
  onMnemonic: (value: string) => void;
  onPassword: (value: string) => void;
  onLook: () => void;
  onReplace: () => void;
  onSecure: () => void;
  onDone: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Image source={wordmark} style={styles.logo} accessibilityLabel="knoad" />
      <PageTitle title="Recovery" subtitle="Enter the 24 words once. They are not saved." />
      {props.rows ? (
        <CutoffSheet rows={props.rows} kind={props.kind} onSecure={props.kind === "spend" ? props.onSecure : undefined} onDone={props.onDone} />
      ) : (
        <View style={styles.wrap}>
          <Field label="24 words" value={props.mnemonic} onChange={props.onMnemonic} multiline />
          <Field label="Phone password" value={props.password} onChange={props.onPassword} secure />
          <Button label="Look at this wallet" onPress={props.onLook} variant="outline" />
          <Button label="Make this phone the one that can spend" onPress={props.onReplace} />
          <Button label="Secure all networks" onPress={props.onSecure} variant="outline" />
        </View>
      )}
      <GhostButton label="Back" onPress={props.onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingTop: 12 },
  logo: { width: 150, height: 28, resizeMode: "contain" },
});
