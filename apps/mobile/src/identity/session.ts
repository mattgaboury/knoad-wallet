import * as SecureStore from "expo-secure-store";

const KEY = "knoad.discord.link";

export type LinkSession = { token: string; expiresAt: string };

export async function readLinkSession(): Promise<LinkSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LinkSession>;
    if (!parsed.token || !parsed.expiresAt || Date.parse(parsed.expiresAt) <= Date.now()) {
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    await SecureStore.deleteItemAsync(KEY);
    return null;
  }
}

export async function saveLinkSession(session: LinkSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt }));
}

export async function clearLinkSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
