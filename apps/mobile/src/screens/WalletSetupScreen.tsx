import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { Field } from "../ui/Field";
import { PageTitle, PrimaryButton } from "../ui/chrome";
import { Icon } from "../ui/icons";

export function AddWalletScreen(props: { busy: boolean; message: string; onBack: () => void; onAdd: (name: string, words: string) => void }) {
  const [name, setName] = useState("");
  const [words, setWords] = useState("");
  return (
    <View style={styles.wrap}>
      <Pressable onPress={props.onBack} style={styles.back} accessibilityLabel="Back">
        <Icon name="chevronLeft" size={22} color={theme.text} />
      </Pressable>
      <PageTitle title="Add a KNOAD wallet" subtitle="Enter the same 24 words. They are not saved." />
      <Field label="Name" value={name} onChange={setName} />
      <Field label="24 words" value={words} onChange={setWords} multiline />
      {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
      <PrimaryButton
        label={props.busy ? "Preparing keys." : "Add wallet"}
        disabled={props.busy || words.trim().split(/\s+/).length < 24}
        onPress={() => {
          const phrase = words;
          setWords("");
          props.onAdd(name, phrase);
        }}
      />
    </View>
  );
}

export function ImportWalletScreen(props: { busy: boolean; message: string; onBack: () => void; onImport: (name: string, privateKey: string) => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  return (
    <View style={styles.wrap}>
      <Pressable onPress={props.onBack} style={styles.back} accessibilityLabel="Back">
        <Icon name="chevronLeft" size={22} color={theme.text} />
      </Pressable>
      <PageTitle title="Import a wallet" subtitle="A standard wallet. This key does not change." />
      <Field label="Name" value={name} onChange={setName} />
      <Field label="Private key" value={key} onChange={setKey} secure />
      {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
      <PrimaryButton
        label={props.busy ? "Saving." : "Import"}
        disabled={props.busy || !key.trim()}
        onPress={() => {
          const secret = key;
          setKey("");
          props.onImport(name, secret);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  back: { alignSelf: "flex-start", padding: 4 },
  message: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
});
