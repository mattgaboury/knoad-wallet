export const LINK_COPY = {
  connect: "Connect Discord",
  connectBody:
    "Link the wallets on this phone to your Discord profile. This does not send a transaction, and your keys stay on this phone.",
  confirmTitle: "Link these wallets to your Discord profile?",
  confirmBody: "Discord confirms who you are. This phone signs a message for each wallet. Nothing is spent or approved.",
  safetyTitle: "How is this safe?",
  safetyBody:
    "Your wallet stays yours. Discord never receives your keys, and this link cannot move funds, approve tokens, or change recovery.",
  success: "These wallets are linked to your Discord profile.",
  full: "This profile can hold one main wallet and three more. Remove one before linking another.",
  notOnChain: "This address is not on that chain yet, so it stays unlinked.",
  disconnect: "Disconnect Discord? Addresses already saved stay on the profile until you remove one this app linked.",
} as const;

export const DISCORD_RETURN_URL = "https://knoad.io/wallet/discord";

export function staysUnlinked(message: string): boolean {
  return /not deployed|not on .+ yet/i.test(message);
}

export function initialSelection(walletIds: string[], activeId: string | null): string[] {
  return activeId && walletIds.includes(activeId) ? [activeId] : [];
}

export function linkSelection(args: {
  selectedIds: string[];
  wallets: { id: string; address: string }[];
  linked: string[];
  remaining: number;
}): { fresh: number; canConfirm: boolean; reason: string | null } {
  const linked = new Set(args.linked.map((address) => address.toLowerCase()));
  const selected = args.wallets.filter((wallet) => args.selectedIds.includes(wallet.id));
  const fresh = selected.filter((wallet) => !linked.has(wallet.address.toLowerCase())).length;
  if (selected.length === 0) return { fresh, canConfirm: false, reason: null };
  if (fresh > args.remaining) return { fresh, canConfirm: false, reason: LINK_COPY.full };
  return { fresh, canConfirm: true, reason: null };
}
