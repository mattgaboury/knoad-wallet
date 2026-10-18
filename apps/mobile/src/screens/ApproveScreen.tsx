import { useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { theme } from "../theme";
import { Inset } from "../ui/bits";
import { GhostButton, OutlineButton, PrimaryButton } from "../ui/chrome";
import { Icon } from "../ui/icons";
import { ChainMark, TokenMark } from "../ui/marks";

export type ApprovalDraft = {
  assetSymbol?: string;
  assetName?: string;
  amount?: string;
  fiat?: string | null;
  toName?: string;
  toDetail?: string;
  chainId?: number;
  network?: string;
  action: string;
  siteName?: string;
  siteUrl?: string;
};

export function ApproveScreen(props: {
  draft?: ApprovalDraft;
  bio: boolean;
  busy?: boolean;
  error?: string;
  onBiometric: () => void;
  onPassword: (password: string) => void;
  passwordLabel?: string;
  onReject?: () => void;
  rejectLabel?: string;
}) {
  const [method, setMethod] = useState<Sensor>(Platform.OS === "ios" ? "Face ID" : "Fingerprint");
  const [passwordOn, setPasswordOn] = useState(!props.bio);
  const [password, setPassword] = useState("");
  const asked = useRef(false);

  useEffect(() => {
    void LocalAuthentication.supportedAuthenticationTypesAsync().then((types) => setMethod(sensorFrom(types)));
  }, []);

  useEffect(() => {
    if (!props.bio || asked.current) return;
    let live = true;
    function ask() {
      if (!live || asked.current || AppState.currentState !== "active") return;
      asked.current = true;
      props.onBiometric();
    }
    ask();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") ask();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [props.bio]);

  const icon = props.bio ? sensorIcon(method) : "lock";
  const heading = props.bio ? `Approve with ${method}` : "Approve with Password";
  const lead = props.bio ? `Use ${method} to approve.` : "Enter the phone password to approve. Biometric unlock can be turned on in Settings.";

  return (
    <View style={styles.wrap}>
      <View style={styles.rings}>
        <View style={styles.ringOuter} />
        <View style={styles.ringMid} />
        <View style={styles.ringInner}>
          <Icon name={icon} size={48} color={theme.mint} />
        </View>
      </View>
      <Text style={styles.title}>{heading}</Text>
      <Text style={styles.subtitle}>{lead}</Text>

      {props.draft?.siteName ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connection</Text>
          <Text style={styles.value}>{props.draft.siteName}</Text>
          {props.draft.siteUrl ? <Text style={styles.meta}>{props.draft.siteUrl}</Text> : null}
          <Text style={styles.meta}>Sees your address only.</Text>
        </View>
      ) : props.draft ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Transaction Details</Text>
            <View style={styles.secure}>
              <Icon name="shieldCheck" size={14} color={theme.mint} />
              <Text style={styles.secureText}>Secure Approval</Text>
            </View>
          </View>
          {props.draft.assetSymbol || props.draft.assetName || props.draft.amount ? (
            <Inset>
              <View style={styles.row}>
                {props.draft.assetSymbol ? <TokenMark symbol={props.draft.assetSymbol} size={32} /> : <Icon name="asset" color={theme.mint} />}
                <View style={styles.copy}>
                  <Text style={styles.label}>Asset</Text>
                  <Text style={styles.value}>{props.draft.assetName ?? props.draft.assetSymbol}</Text>
                </View>
                {props.draft.amount ? (
                  <View style={styles.end}>
                    <Text style={styles.value}>{props.draft.amount}</Text>
                    {props.draft.fiat ? <Text style={styles.meta}>{props.draft.fiat}</Text> : null}
                  </View>
                ) : null}
              </View>
            </Inset>
          ) : null}
          {props.draft.toName ? (
            <Inset>
              <View style={styles.row}>
                <Icon name="link" color={theme.mint} />
                <View style={styles.copy}>
                  <Text style={styles.label}>To</Text>
                  <Text style={styles.value}>{props.draft.toName}</Text>
                  {props.draft.toDetail ? <Text style={styles.meta}>{props.draft.toDetail}</Text> : null}
                </View>
              </View>
            </Inset>
          ) : null}
          {props.draft.network ? (
            <Inset>
              <View style={styles.row}>
                {props.draft.chainId ? <ChainMark chainId={props.draft.chainId} size={28} /> : <Icon name="asset" color={theme.mint} />}
                <View style={styles.copy}>
                  <Text style={styles.label}>Network</Text>
                  <Text style={styles.value}>{props.draft.network}</Text>
                </View>
              </View>
            </Inset>
          ) : null}
          <Inset>
            <View style={styles.row}>
              <Icon name="permissions" color={theme.textMuted} />
              <View style={styles.copy}>
                <Text style={styles.label}>Action</Text>
                <Text style={styles.value}>{props.draft.action}</Text>
              </View>
            </View>
          </Inset>
        </View>
      ) : null}

      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      {props.bio ? (
        <>
          <PrimaryButton label={`Use ${method}`} icon={icon} onPress={props.onBiometric} disabled={props.busy} />
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.or}>OR</Text>
            <View style={styles.orLine} />
          </View>
        </>
      ) : null}
      {passwordOn && !props.bio ? (
        <View style={styles.passwordBlock}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Phone password"
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => props.onPassword(password)}
            style={styles.input}
          />
          <PrimaryButton label={props.passwordLabel ?? "Approve"} icon="lock" onPress={() => props.onPassword(password)} disabled={props.busy} />
        </View>
      ) : passwordOn ? (
        <View style={styles.passwordBlock}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Phone password"
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => props.onPassword(password)}
            style={styles.input}
          />
          <OutlineButton label={props.passwordLabel ?? "Use Password Instead"} icon="lock" onPress={() => props.onPassword(password)} disabled={props.busy} />
        </View>
      ) : (
        <OutlineButton label="Use Password" icon="lock" onPress={() => setPasswordOn(true)} />
      )}
      {props.onReject ? <GhostButton label={props.rejectLabel ?? "Reject"} onPress={props.onReject} disabled={props.busy} /> : null}
    </View>
  );
}

type Sensor = "Face ID" | "Touch ID" | "Fingerprint" | "Face unlock";

function sensorFrom(types: LocalAuthentication.AuthenticationType[]): Sensor {
  const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  if (Platform.OS === "ios") return face ? "Face ID" : "Touch ID";
  if (finger) return "Fingerprint";
  if (face) return "Face unlock";
  return "Fingerprint";
}

function sensorIcon(method: Sensor): "faceId" | "fingerprint" {
  return method === "Face ID" || method === "Face unlock" ? "faceId" : "fingerprint";
}

const styles = StyleSheet.create({
  wrap: { gap: 14, paddingBottom: 24 },
  rings: { alignSelf: "center", width: 180, height: 180, alignItems: "center", justifyContent: "center", marginTop: 12 },
  ringOuter: { position: "absolute", width: 180, height: 180, borderRadius: 90, borderWidth: 1, borderColor: "rgba(46,230,175,0.08)" },
  ringMid: { position: "absolute", width: 140, height: 140, borderRadius: 70, borderWidth: 1, borderColor: "rgba(46,230,175,0.16)" },
  ringInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: "rgba(46,230,175,0.45)",
    backgroundColor: "rgba(46,230,175,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.text, fontFamily: theme.font.bold, fontSize: 30, textAlign: "center" },
  subtitle: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  card: { backgroundColor: theme.card, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16 },
  secure: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: theme.mint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  secureText: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1 },
  end: { alignItems: "flex-end" },
  label: { color: theme.textDim, fontFamily: theme.font.medium, fontSize: 12 },
  value: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
  meta: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 12 },
  error: { color: theme.danger, fontFamily: theme.font.regular, fontSize: 14, textAlign: "center" },
  orRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  orLine: { flex: 1, height: 1, backgroundColor: theme.border },
  or: { color: theme.textDim, fontFamily: theme.font.medium, fontSize: 12, textAlign: "center", letterSpacing: 1 },
  passwordBlock: { gap: 10 },
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
});
