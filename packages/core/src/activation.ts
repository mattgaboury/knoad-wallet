import { mnemonicToSeed } from "@scure/bip39";
import type { Address } from "viem";
import {
  accountInitCode,
  activationDigest,
  buildUserOp,
  executeAndRotateCalldata,
  signSecp256k1,
  userOpHash,
} from "./account";
import { deployments } from "./deployments";
import { assertRecoveryMnemonic, deriveAtPath, initialHotPath, recoveryPath } from "./derivation";
import type { OperationGas } from "./gas";
import { KEY_SECP256K1, type Call, type Hex, type KeyType, type PackedUserOperation } from "./types";

/** A recovery-signed first key for one chain, prepared while the words are still in memory. */
export type PreparedActivation = {
  chainId: number;
  initialSigner: Address;
  initialKey: Hex;
  keyType: typeof KEY_SECP256K1;
  activationSignature: Hex;
};

/**
 * Signs one activation per chain from the words. The derived first key is the same on a restored phone.
 * Restoring does not cut off a phone that already holds that key.
 */
export async function prepareActivations(
  phrase: string,
  account: Address,
  chainIds: readonly number[],
  accountIndex = 0,
): Promise<PreparedActivation[]> {
  if (!phrase.trim()) throw new Error("The 24 words are missing.");
  assertRecoveryMnemonic(phrase);
  const seed = await mnemonicToSeed(phrase.trim(), "");
  const recoveryKey = deriveAtPath(seed, recoveryPath(accountIndex, 0)).privateKey;
  const prepared: PreparedActivation[] = [];
  for (const chainId of chainIds) {
    const hot = deriveAtPath(seed, initialHotPath(accountIndex, chainId));
    const activationSignature = await signSecp256k1(
      recoveryKey,
      activationDigest({
        account,
        chainId: BigInt(chainId),
        initialSigner: hot.address,
        keyType: KEY_SECP256K1,
      }),
    );
    prepared.push({
      chainId,
      initialSigner: hot.address,
      initialKey: hot.privateKey,
      keyType: KEY_SECP256K1,
      activationSignature,
    });
  }
  return prepared;
}

/** First use: deploy with the signed key, then an empty spend that retires it for the next key. */
export function firstUseDraft(args: {
  account: Address;
  chainId: bigint;
  recovery: Address;
  initialSigner: Address;
  initialKeyType?: KeyType;
  activationSignature: Hex;
  nextSigner: Address;
  nextKeyType: KeyType;
  calls?: Call[];
  gas?: OperationGas;
  factory?: Address;
  index?: bigint;
}): Omit<PackedUserOperation, "signature"> {
  const keyType = args.initialKeyType ?? KEY_SECP256K1;
  const initCode = accountInitCode({
    factory: args.factory ?? deployments.factory,
    recovery: args.recovery,
    index: args.index,
    initialSigner: args.initialSigner,
    keyType,
    signature: args.activationSignature,
  });
  const callData = executeAndRotateCalldata({
    calls: args.calls ?? [],
    nextSigner: args.nextSigner,
    nextKeyType: args.nextKeyType,
  });
  return buildUserOp({
    sender: args.account,
    nonce: 0n,
    callData,
    keyType,
    initCode,
    gas: args.gas,
  });
}

export async function buildFirstUseOp(
  args: Parameters<typeof firstUseDraft>[0] & {
    signInitial: (digest: Hex) => Promise<Hex>;
  },
): Promise<PackedUserOperation> {
  const draft = firstUseDraft(args);
  const signature = await args.signInitial(userOpHash(draft, args.chainId));
  return { ...draft, signature };
}
