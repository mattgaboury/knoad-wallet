import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ChainCutoffAction, SecureNetworkReason, SecureNetworkStatus } from "@knoad/wallet-core";
import { theme } from "../theme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export type CutoffRow = {
  chainId: number;
  name: string;
  action: ChainCutoffAction;
  deployed: boolean;
  calls?: string[];
  result?: string;
  submitted?: boolean;
  stillOpen?: boolean;
  secureStatus?: SecureNetworkStatus;
  secureReason?: SecureNetworkReason;
  awaitingSwitch?: boolean;
};

function sentence(row: CutoffRow): string {
  if (row.result) return `${row.name}. ${row.result}`;
  if (row.secureStatus === "not-checked" || row.action === "not-checked") return `${row.name}: could not be checked.`;
  if (row.secureStatus === "closed" && row.awaitingSwitch) {
    return `${row.name}: already set up. The other step switches the key.`;
  }
  if (row.secureStatus === "closed") return `${row.name}: already this phone.`;
  if (row.action === "already-here") return `${row.name}: already at this step.`;
  if (row.secureStatus === "self-funded" && row.submitted) {
    return `${row.name}: this phone is paying from this chain's own balance. The other phone can still open it until that lands.`;
  }
  if (row.secureStatus === "needs-outside-payer" && row.secureReason === "tokens") {
    return `${row.name}: holds tokens. This chain is still open to the other phone. Someone pays the network fee to close it.`;
  }
  if (row.secureStatus === "needs-outside-payer" && row.secureReason === "empty") {
    return `${row.name}: nothing is here yet. The other phone can still open it when something arrives. Someone pays the network fee to close it.`;
  }
  if (row.secureStatus === "needs-outside-payer") {
    return `${row.name}: this chain is still open to the other phone. Someone pays the network fee to close it.`;
  }
  if (row.submitted) {
    return `${row.name}: switched to this phone. The other phone can still open this chain until it lands.`;
  }
  if (row.stillOpen) return `${row.name}: still open to the other phone.`;
  if (row.action === "deploy-and-retire") {
    return `${row.name}: not set up yet. Anyone can pay to put this phone's key here. Whoever pays first chooses the key.`;
  }
  const count = row.calls?.length ?? 0;
  if (count > 1) {
    return `${row.name}: ${count} steps, in order. Anyone can pay each one. The other phone can still spend until the first one lands.`;
  }
  return `${row.name}: switches to this phone when someone pays. The other phone can still spend until then.`;
}

export function CutoffSheet(props: { rows: CutoffRow[]; kind?: "spend" | "secure"; onSecure?: () => void; onDone: () => void }) {
  const [openCall, setOpenCall] = useState<number | null>(null);
  const secure = props.kind === "secure";
  const stillOpen = props.rows.some((row) => row.stillOpen);
  return (
    <Card>
      <Text style={styles.title}>{secure ? "Secure all networks" : "Make this phone the one that can spend"}</Text>
      <Text style={styles.body}>
        {secure
          ? "Optional. Someone pays the network fee where this phone cannot. There is no KNOAD fee."
          : "One entry covers every chain that is already set up, or that can pay from its own balance. Each chain switches when its own step lands. Until then, the other phone can still spend there."}
      </Text>
      {!secure && stillOpen ? (
        <Text style={styles.body}>Some chains are still open to the other phone. Secure all networks closes them.</Text>
      ) : null}
      {props.rows.map((row) => {
        const calls = row.calls ?? [];
        return (
          <View key={row.chainId}>
            <Text style={styles.line}>{sentence(row)}</Text>
            {calls.length > 0 ? (
              <Text style={styles.link} onPress={() => setOpenCall(openCall === row.chainId ? null : row.chainId)}>
                {openCall === row.chainId ? "Hide" : "Show what anyone can pay"}
              </Text>
            ) : null}
            {openCall === row.chainId
              ? calls.map((call, index) => (
                  <Text key={`${row.chainId}-${index}`} style={styles.call}>
                    {calls.length > 1 ? `${index + 1}. ${call}` : call}
                  </Text>
                ))
              : null}
          </View>
        );
      })}
      {!secure && props.onSecure ? <Button label="Secure all networks" onPress={props.onSecure} variant="outline" /> : null}
      <Button label="Done" onPress={props.onDone} variant="ghost" />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 18, marginBottom: 8 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20 },
  line: { color: theme.text, fontFamily: theme.font.regular, fontSize: 14, lineHeight: 20, marginTop: 12 },
  link: { color: theme.mint, fontFamily: theme.font.regular, fontSize: 13, marginTop: 4 },
  call: { marginTop: 6, color: theme.text, fontFamily: theme.font.regular, fontSize: 11, lineHeight: 16 },
});
