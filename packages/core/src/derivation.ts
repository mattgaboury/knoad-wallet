import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeed, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { bytesToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Hardened, and not under BIP-44, so a MetaMask import does not reveal recovery. */
export function recoveryPath(account: number, epoch: number): string {
  assertIndex(account, "account");
  assertIndex(epoch, "epoch");
  return `m/7331'/60'/${account}'/0'/${epoch}'`;
}

/** One-time secp256k1 hot key for one chain. The first included operation on that chain retires it. */
export function initialHotPath(account: number, chainId: number): string {
  assertIndex(account, "account");
  assertIndex(chainId, "chain");
  return `m/7331'/60'/${account}'/1'/${chainId}'`;
}

export function generateRecoveryMnemonic(): string {
  return generateMnemonic(wordlist, 256);
}

export function assertRecoveryMnemonic(mnemonic: string): void {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24 || !validateMnemonic(mnemonic.trim(), wordlist)) {
    throw new Error("Recovery requires a valid 24-word BIP-39 phrase.");
  }
}

export function deriveAtPath(seed: Uint8Array, path: string): { address: Address; privateKey: Hex } {
  if (!path.startsWith("m/7331'/60'/")) {
    throw new Error("Refusing a path outside m/7331'/60'.");
  }
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.privateKey || child.privateKey.length !== 32) {
    throw new Error("Derivation did not produce a private key.");
  }
  const privateKey = bytesToHex(child.privateKey);
  return { address: privateKeyToAccount(privateKey).address, privateKey };
}

export function deriveSecp256k1(
  mnemonic: string,
  path: string,
  passphrase = "",
): { address: Address; privateKey: Hex } {
  assertRecoveryMnemonic(mnemonic);
  return deriveAtPath(mnemonicToSeedSync(mnemonic.trim(), passphrase), path);
}

export async function deriveSecp256k1Async(
  mnemonic: string,
  path: string,
  passphrase = "",
): Promise<{ address: Address; privateKey: Hex }> {
  assertRecoveryMnemonic(mnemonic);
  return deriveAtPath(await mnemonicToSeed(mnemonic.trim(), passphrase), path);
}

export function deriveRecovery(
  mnemonic: string,
  account: number,
  epoch: number,
  passphrase = "",
) {
  return deriveSecp256k1(mnemonic, recoveryPath(account, epoch), passphrase);
}

export async function deriveRecoveryAsync(
  mnemonic: string,
  account: number,
  epoch: number,
  passphrase = "",
) {
  return deriveSecp256k1Async(mnemonic, recoveryPath(account, epoch), passphrase);
}

export function deriveInitialHot(mnemonic: string, account: number, chainId: number, passphrase = "") {
  return deriveSecp256k1(mnemonic, initialHotPath(account, chainId), passphrase);
}

function assertIndex(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new Error(`${name} must be a non-negative index.`);
  }
}
