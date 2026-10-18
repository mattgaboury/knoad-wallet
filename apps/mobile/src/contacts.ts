import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAddress, type Address } from "viem";

const KEY = "knoad.contacts";

export type SavedContact = {
  address: Address;
  name: string;
  ens?: string;
};

export async function loadContacts(): Promise<SavedContact[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedContact[];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      try {
        const name = item.name?.trim();
        if (!name) return [];
        return [{ address: getAddress(item.address), name, ens: item.ens?.trim() || undefined }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function write(contacts: SavedContact[]): Promise<SavedContact[]> {
  await AsyncStorage.setItem(KEY, JSON.stringify(contacts));
  return contacts;
}

export async function saveContact(contact: SavedContact): Promise<SavedContact[]> {
  const address = getAddress(contact.address);
  const name = contact.name.trim();
  if (!name) throw new Error("Enter a name.");
  const current = await loadContacts();
  const next = [{ address, name, ens: contact.ens?.trim() || undefined }, ...current.filter((item) => item.address !== address)];
  return write(next);
}

export async function renameContact(address: Address, name: string): Promise<SavedContact[]> {
  const target = getAddress(address);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a name.");
  const current = await loadContacts();
  return write(current.map((item) => (item.address === target ? { ...item, name: trimmed } : item)));
}

export async function removeContact(address: Address): Promise<SavedContact[]> {
  const target = getAddress(address);
  const current = await loadContacts();
  return write(current.filter((item) => item.address !== target));
}
