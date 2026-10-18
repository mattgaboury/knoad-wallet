import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbiItem, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ACCOUNT_CREATED_EVENT,
  accountAbi,
  buildRecoveryRequest,
  deriveInitialHot,
  deriveRecovery,
  initialHotPath,
  predictAccount,
  recoveryDigest,
  recoveryPath,
  signSecp256k1,
  type KeyType,
} from "@knoad/wallet-core";

export const PUBLIC_TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

export function derivationVectors(mnemonic = PUBLIC_TEST_MNEMONIC) {
  return {
    mnemonic,
    warning: "Public test mnemonic. Never fund an account derived from it.",
    path: {
      recovery: "m/7331'/60'/<account>'/0'/<epoch>'",
      initialHot: "m/7331'/60'/<account>'/1'/<chainId>'",
    },
    accounts: [0, 1].map((account) => ({
      account,
      paths: {
        recoveryEpoch0: recoveryPath(account, 0),
        recoveryEpoch1: recoveryPath(account, 1),
        initialHotChain1: initialHotPath(account, 1),
        initialHotChain8453: initialHotPath(account, 8453),
      },
      recoveryEpoch0: deriveRecovery(mnemonic, account, 0).address,
      recoveryEpoch1: deriveRecovery(mnemonic, account, 1).address,
      initialHotChain1: deriveInitialHot(mnemonic, account, 1).address,
      initialHotChain8453: deriveInitialHot(mnemonic, account, 8453).address,
    })),
  };
}

export function writeDerivationVectors(path = "test-vectors/vectors.json"): string {
  const body = `${JSON.stringify(derivationVectors(), null, 2)}\n`;
  writeFileSync(path, body);
  return path;
}

export function predictFromArgs(args: {
  factory: Address;
  implementation: Address;
  proxyCreationCode?: Hex;
  artifactPath?: string;
  recovery: Address;
  index?: bigint;
}): Address {
  const bytecode =
    args.proxyCreationCode ??
    (JSON.parse(readFileSync(args.artifactPath ?? "out/ERC1967Proxy.sol/ERC1967Proxy.json", "utf8")) as {
      bytecode: { object: Hex };
    }).bytecode.object;
  return predictAccount({ ...args, proxyCreationCode: bytecode });
}

export async function buildRecovery(args: {
  mnemonic: string;
  accountIndex: number;
  account: Address;
  chainId: bigint;
  newHotSigner: Address;
  newHotKeyType: KeyType;
  recoveryEpoch: bigint;
  authorityNonce: bigint;
  deadline: bigint;
  hardware?: boolean;
  passphrase?: string;
}) {
  const current = deriveRecovery(args.mnemonic, args.accountIndex, Number(args.recoveryEpoch), args.passphrase ?? "");
  const nextRecoveryAuthority = args.hardware
    ? zeroAddress
    : deriveRecovery(args.mnemonic, args.accountIndex, Number(args.recoveryEpoch) + 1, args.passphrase ?? "").address;
  const request = buildRecoveryRequest({
    account: args.account,
    chainId: args.chainId,
    newHotSigner: args.newHotSigner,
    newHotKeyType: args.newHotKeyType,
    nextRecoveryAuthority,
    recoveryEpoch: args.recoveryEpoch,
    authorityNonce: args.authorityNonce,
    deadline: args.deadline,
    mnemonicClient: !args.hardware,
  });
  const digest = recoveryDigest(request);
  const signature = await signSecp256k1(current.privateKey, digest);
  return {
    recoveryAuthority: current.address,
    nextRecoveryAuthority,
    digest,
    signature,
    request: {
      ...request,
      chainId: request.chainId.toString(),
      recoveryEpoch: request.recoveryEpoch.toString(),
      authorityNonce: request.authorityNonce.toString(),
      deadline: request.deadline.toString(),
    },
  };
}

export async function discoverAccounts(args: { rpc: string; factory: Address; recovery: Address }) {
  const client = createPublicClient({ transport: http(args.rpc) });
  const logs = await client.getLogs({
    address: args.factory,
    event: parseAbiItem(ACCOUNT_CREATED_EVENT),
    args: { recoveryAuthority: args.recovery },
    fromBlock: 0n,
    toBlock: "latest",
  });
  return logs.map((log) => ({
    account: log.args.account,
    initialHotSigner: log.args.initialHotSigner,
    index: log.args.index?.toString(),
    blockNumber: log.blockNumber.toString(),
  }));
}

export async function broadcastRecovery(args: {
  rpc: string;
  payerKey: Hex;
  account: Address;
  request: {
    account: Address;
    chainId: bigint;
    newHotSigner: Address;
    newHotKeyType: number;
    nextRecoveryAuthority: Address;
    recoveryEpoch: bigint;
    authorityNonce: bigint;
    deadline: bigint;
  };
  signature: Hex;
}) {
  const account = privateKeyToAccount(args.payerKey);
  const client = createWalletClient({ account, transport: http(args.rpc) });
  const hash = await client.writeContract({
    address: args.account,
    abi: accountAbi,
    functionName: "recover",
    args: [args.request, args.signature],
    chain: null,
  });
  return hash;
}
