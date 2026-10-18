import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "knoad.wc.sessions";

export type SavedSite = {
  topic: string;
  name: string;
  url: string;
  icon?: string;
  connectedAt: number;
};

export async function loadSites(): Promise<SavedSite[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function rememberSite(site: SavedSite): Promise<SavedSite[]> {
  const next = [site, ...(await loadSites()).filter((item) => item.topic !== site.topic)].slice(0, 20);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function forgetSite(topic: string): Promise<SavedSite[]> {
  const next = (await loadSites()).filter((item) => item.topic !== topic);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
