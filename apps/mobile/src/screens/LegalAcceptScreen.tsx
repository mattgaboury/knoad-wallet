import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LEGAL_DOCUMENTS, LEGAL_EFFECTIVE_DATE, reachedEnd, type LegalChunk, type LegalDocument } from "../legal";
import { theme } from "../theme";
import { Button } from "../ui/Button";

export function LegalAcceptScreen(props: { mode: "accept" | "read"; onAccept: () => void; onClose?: () => void }) {
  const insets = useSafeAreaInsets();
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const canAccept = props.mode === "read" || reachedEnd(layoutHeight, offsetY, contentHeight);

  return (
    <View style={[styles.sheet, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onLayout={(event) => setLayoutHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_width, height) => setContentHeight(height)}
        onScroll={(event) => setOffsetY(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        {LEGAL_DOCUMENTS.map((document) => (
          <DocumentBlock key={document.title} document={document} />
        ))}
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {props.mode === "accept" ? (
          <Button label={canAccept ? "Accept" : "Scroll to the end"} onPress={props.onAccept} disabled={!canAccept} />
        ) : (
          <Button label="Close" onPress={props.onClose ?? (() => undefined)} variant="ghost" />
        )}
      </View>
    </View>
  );
}

function DocumentBlock(props: { document: LegalDocument }) {
  return (
    <View style={styles.document}>
      <Text style={styles.kicker}>knoad</Text>
      <Text style={styles.title}>{props.document.title}</Text>
      <Text style={styles.meta}>{`Effective date: ${LEGAL_EFFECTIVE_DATE}`}</Text>
      <Text style={styles.meta}>Cronosynthesis LLC</Text>
      <Pressable onPress={() => void Linking.openURL(props.document.url)} accessibilityRole="link">
        <Text style={styles.link}>{props.document.url.replace("https://", "")}</Text>
      </Pressable>
      {props.document.chunks.map((chunk, index) => (
        <ChunkBlock key={`${props.document.title}-${index}`} chunk={chunk} />
      ))}
    </View>
  );
}

function ChunkBlock(props: { chunk: LegalChunk }) {
  if (props.chunk.type === "h") return <Text style={styles.heading}>{props.chunk.text}</Text>;
  if (props.chunk.type === "ul") {
    return (
      <View style={styles.list}>
        {props.chunk.items.map((item) => (
          <Text key={item} style={styles.body}>{`• ${item}`}</Text>
        ))}
      </View>
    );
  }
  return <Text style={styles.body}>{props.chunk.text}</Text>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: theme.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 28, gap: 28 },
  document: { gap: 12 },
  kicker: {
    color: theme.mint,
    fontFamily: theme.font.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: { color: theme.text, fontFamily: theme.font.bold, fontSize: 28, letterSpacing: -0.4 },
  meta: { color: theme.textDim, fontFamily: theme.font.regular, fontSize: 13 },
  heading: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16, marginTop: 8 },
  body: { color: theme.textMuted, fontFamily: theme.font.regular, fontSize: 15, lineHeight: 22 },
  list: { gap: 6, paddingLeft: 4 },
  link: { color: theme.mint, fontFamily: theme.font.semibold, fontSize: 15 },
  bar: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingHorizontal: 22,
    paddingTop: 8,
    backgroundColor: theme.bg,
  },
});
