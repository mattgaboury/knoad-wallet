/** Phone-only palette. The website tokens in @knoad/brand stay unchanged. */
export const theme = {
  bg: "#050907",
  card: "#0C1511",
  elevated: "#112019",
  inset: "#0A120E",
  border: "#1B3328",
  borderMint: "rgba(46,230,175,0.45)",
  mint: "#2EE6AF",
  mintPressed: "#23C997",
  mintTint: "rgba(46,230,175,0.12)",
  text: "#F5F8F6",
  textMuted: "#A1AEA8",
  textDim: "#77867F",
  onMint: "#04110B",
  warning: "#F2B94B",
  warningTint: "rgba(242,185,75,0.12)",
  danger: "#F46D7C",
  dangerTint: "rgba(244,109,124,0.12)",
  info: "#5B8CFF",
  radius: { sm: 10, md: 14, lg: 18, pill: 999 },
  space: { gutter: 20, card: 16, cardGap: 12, rowGap: 10 },
  font: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
  type: {
    balance: 44,
    page: 28,
    hero: 30,
    card: 17,
    row: 15,
    body: 14,
    caption: 12,
    chip: 10,
    amount: 34,
  },
} as const;

export const TESTNET_IDS = new Set([11155111, 84532]);

export function isTestnet(chainId: number): boolean {
  return TESTNET_IDS.has(chainId);
}
