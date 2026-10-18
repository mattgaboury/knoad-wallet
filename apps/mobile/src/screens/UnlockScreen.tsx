import { Image, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { GhostButton, PageTitle, PrimaryButton, wordmark } from "../ui/chrome";
import { Field } from "../ui/Field";
import { ApproveScreen } from "./ApproveScreen";

export function UnlockScreen(props: {
  password: string;
  message: string;
  error: boolean;
  busy: boolean;
  bio: boolean;
  onPassword: (value: string) => void;
  onUnlock: () => void;
  onBiometric: () => void;
  onCreate: () => void;
}) {
  if (props.bio) {
    return (
      <View style={styles.wrap}>
        <Image source={wordmark} style={styles.logo} accessibilityLabel="knoad" />
        <ApproveScreen
          bio
          busy={props.busy}
          error={props.error ? props.message : undefined}
          onBiometric={props.onBiometric}
          onPassword={(value) => {
            props.onPassword(value);
            props.onUnlock();
          }}
          passwordLabel={props.busy ? "Unlocking" : "Unlock"}
        />
        <GhostButton label="New wallet" onPress={props.onCreate} disabled={props.busy} />
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Image source={wordmark} style={styles.logo} accessibilityLabel="knoad" />
      <PageTitle title="Unlock" subtitle="The password only unlocks this phone." />
      <Field label="Phone password" value={props.password} onChange={props.onPassword} onSubmit={props.onUnlock} secure />
      <PrimaryButton label={props.busy ? "Unlocking" : "Unlock"} onPress={props.onUnlock} disabled={props.busy} />
      {props.message ? <Text style={props.error ? styles.error : styles.status}>{props.message}</Text> : null}
      <GhostButton label="New wallet" onPress={props.onCreate} disabled={props.busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingTop: 12 },
  logo: { width: 150, height: 28, resizeMode: "contain" },
  status: { color: theme.text, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
  error: { color: theme.danger, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
});
