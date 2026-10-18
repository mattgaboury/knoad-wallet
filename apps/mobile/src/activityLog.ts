import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PendingSend, VaultRecord } from "@knoad/wallet-core";

const KEY = "knoad.activity";

export type ActivityStatus = "pending" | "included" | "failed" | "cancelled" | "replaced";

export type ActivityEntry = {
  id: string;
  chainId: number;
  kind: "send" | "cancel" | "speed" | "swap" | "bridge";
  hash: string;
  amount?: string;
  asset?: string;
  to?: string;
  toName?: string;
  time: number;
  status: ActivityStatus;
  reason?: string;
  txHash?: string;
  nonce?: string;
};

export async function loadActivity(): Promise<ActivityEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActivityEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(entries: ActivityEntry[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries.slice(0, 80)));
}

export async function appendActivity(entry: ActivityEntry): Promise<void> {
  const current = await loadActivity();
  await write([entry, ...current.filter((item) => item.hash !== entry.hash)]);
}

export async function markActivity(hash: string, status: ActivityStatus): Promise<void> {
  await patchActivity(hash, { status });
}

export async function patchActivity(hash: string, patch: Partial<Pick<ActivityEntry, "status" | "reason" | "txHash" | "nonce">>): Promise<void> {
  const current = await loadActivity();
  await write(current.map((item) => (item.hash === hash ? { ...item, ...patch } : item)));
}

export function pendingRows(record: VaultRecord | null): { chainId: number; pending: PendingSend }[] {
  if (!record) return [];
  const rows: { chainId: number; pending: PendingSend }[] = [];
  for (const [id, state] of Object.entries(record.chains)) {
    if (state?.pendingSend) rows.push({ chainId: Number(id), pending: state.pendingSend });
  }
  return rows.sort((left, right) => (right.pending.sentAt ?? 0) - (left.pending.sentAt ?? 0));
}
