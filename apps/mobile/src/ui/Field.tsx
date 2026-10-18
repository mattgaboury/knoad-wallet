import { StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "../theme";

export function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  secure?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        onSubmitEditing={props.onSubmit}
        secureTextEntry={props.secure}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={props.secure ? "password" : "off"}
        blurOnSubmit={false}
        multiline={props.multiline}
        placeholderTextColor={theme.textDim}
        returnKeyType={props.onSubmit ? "done" : "default"}
        textContentType={props.secure ? "password" : "none"}
        style={[styles.input, props.multiline ? styles.multi : null]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  input: {
    color: theme.text,
    backgroundColor: theme.elevated,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: 14,
    fontFamily: theme.font.regular,
    fontSize: 16,
  },
  multi: { minHeight: 96, textAlignVertical: "top" },
});
