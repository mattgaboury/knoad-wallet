import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getAddress, isAddress } from "viem";
import { getChain } from "@knoad/wallet-core";
import type { HeldNft } from "../nfts";
import { theme } from "../theme";
import { PageTitle, PrimaryButton } from "../ui/chrome";
import { Icon } from "../ui/icons";
import { ChainMark } from "../ui/marks";

export function NftScreen(props: { nft: HeldNft; onBack: () => void; onTransfer: (to: string) => void; canTransfer?: boolean }) {
  const [to, setTo] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const chain = getChain(props.nft.chainId);
  const ready = isAddress(to.trim());
  return (
    <View style={styles.wrap}>
      <Pressable onPress={props.onBack} style={styles.back} accessibilityLabel="Back">
        <Icon name="chevronLeft" size={22} color={theme.text} />
      </Pressable>
      <PageTitle title={props.nft.name} subtitle={`${props.nft.collection} · #${props.nft.tokenId}`} />
      {props.nft.image && !imageFailed ? (
        <Image source={{ uri: props.nft.image }} style={styles.image} resizeMode="cover" onError={() => setImageFailed(true)} />
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}># {props.nft.tokenId}</Text>
        </View>
      )}
      <View style={styles.chain}>
        <ChainMark chainId={props.nft.chainId} size={16} />
        <Text style={styles.meta}>{chain?.name ?? "Network"}</Text>
      </View>
      {props.canTransfer === false ? <Text style={styles.meta}>Transfers stay on a KNOAD wallet.</Text> : <Text style={styles.label}>Send to</Text>}
      {props.canTransfer === false ? null : <TextInput
        value={to}
        onChangeText={setTo}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Address"
        placeholderTextColor={theme.textDim}
        style={styles.input}
      />}
      {props.canTransfer === false ? null : <PrimaryButton
        label="Transfer"
        disabled={!ready}
        onPress={() => {
          if (!ready) return;
          props.onTransfer(getAddress(to.trim()));
        }}
      />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  back: { alignSelf: "flex-start", padding: 4 },
  image: { width: "100%", height: 280, borderRadius: theme.radius.lg, backgroundColor: theme.inset },
  fallback: {
    width: "100%",
    height: 180,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.inset,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 22 },
  chain: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 13 },
  label: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: theme.mint,
    borderRadius: theme.radius.md,
    color: theme.text,
    fontFamily: theme.font.regular,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
