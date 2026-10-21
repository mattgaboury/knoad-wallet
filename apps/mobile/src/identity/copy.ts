export const LINK_COPY = {
  settingsLead: "Link Discord and your wallets for eligible roles and access in servers using KNOAD.",
  settingsConnect: "Connect",
  settingsConnected: "Connected",
  title: "KNOAD Account",
  subtitle:
    "Your KNOAD account helps participating Discord servers recognize eligible wallets for roles and access. Linking is not a guarantee of any particular role.",
  connectBody: "Connect your Discord profile so KNOAD can recognize your wallets for eligible roles and access.",
  reassurance: "Your private keys stay private. Connecting does not grant access to funds.",
  continue: "Continue with Discord",
  verifyTitle: "Link your wallet",
  verifyTitlePlural: "Link your wallets",
  verifyBody: "Verify the wallet on this phone to add it to your KNOAD account.",
  verifyBodyPlural: "Verify the wallets on this phone to add them to your KNOAD account.",
  verifyNote: "You’ll sign a verification message. No transaction, gas fee, or token approval.",
  walletOnPhone: "Wallet on this phone",
  walletsOnPhone: "Wallets on this phone",
  linkOne: "Link wallet",
  linkMany: "Link wallets",
  discordConnected: "Discord connected",
  linkedWallets: "Linked wallets",
  footnote: "Used to check eligible roles and access in participating servers.",
  manage: "Manage wallets",
  main: "Main",
  alternative: "Alternative",
  copy: "Copy",
  copied: "Copied.",
  remove: "Remove",
  confirmRemove: "Confirm remove",
  disconnect: "Disconnect Discord",
  disconnectBody: "Disconnect Discord? Addresses already saved stay on the profile until you remove one this app linked.",
  success: "These wallets are linked to your Discord profile.",
  full: "This profile can hold one main wallet and three more. Remove one before linking another.",
  notOnChain: "This address is not on that chain yet, so it stays unlinked.",
  disconnected: "Discord is disconnected.",
} as const;

export const DISCORD_RETURN_URL = "https://knoad.io/wallet/discord";

export function staysUnlinked(message: string): boolean {
  return /not deployed|not on .+ yet/i.test(message);
}

export function initialSelection(walletIds: string[], activeId: string | null): string[] {
  if (walletIds.length === 1) return [walletIds[0]];
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
