import { createPublicClient, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { accountAbi, deriveInitialHot, deriveRecovery, initialHotPath, recoveryPath } from "@knoad/wallet-core";
import { broadcastRecovery, buildRecovery, discoverAccounts, predictFromArgs, writeDerivationVectors } from "./commands";

const command = process.argv[2];
const flags = readFlags(process.argv.slice(3));

try {
  const output = await run(command, flags);
  process.stdout.write(`${typeof output === "string" ? output : JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function run(name: string | undefined, args: Map<string, string>) {
  if (name === "derive") {
    const mnemonic = required(args, "mnemonic");
    const account = Number(args.get("account") ?? "0");
    const epoch = Number(args.get("epoch") ?? "0");
    const passphrase = args.get("passphrase") ?? "";
    return {
      recovery: deriveRecovery(mnemonic, account, epoch, passphrase).address,
      initialHot: deriveInitialHot(mnemonic, account, Number(args.get("chain") ?? "84532"), passphrase).address,
      paths: {
        recovery: recoveryPath(account, epoch),
        initialHot: initialHotPath(account, Number(args.get("chain") ?? "84532")),
      },
    };
  }

  if (name === "vectors") {
    const path = writeDerivationVectors(args.get("out") ?? "test-vectors/vectors.json");
    return { wrote: path };
  }

  if (name === "predict") {
    const address = predictFromArgs({
      factory: addressFlag(args, "factory"),
      implementation: addressFlag(args, "implementation"),
      recovery: addressFlag(args, "recovery"),
      index: BigInt(args.get("index") ?? "0"),
      artifactPath: args.get("artifact"),
    });
    return { account: address };
  }

  if (name === "discover") {
    return discoverAccounts({
      rpc: required(args, "rpc"),
      factory: addressFlag(args, "factory"),
      recovery: addressFlag(args, "recovery"),
    });
  }

  if (name === "recover") {
    const rpc = args.get("rpc");
    const account = addressFlag(args, "account");
    let chainId = args.has("chain-id") ? BigInt(required(args, "chain-id")) : undefined;
    let recoveryEpoch = args.has("epoch") ? BigInt(required(args, "epoch")) : undefined;
    let authorityNonce = args.has("nonce") ? BigInt(required(args, "nonce")) : undefined;
    if (rpc && (chainId === undefined || recoveryEpoch === undefined || authorityNonce === undefined)) {
      const client = createPublicClient({ transport: http(rpc) });
      chainId ??= BigInt(await client.getChainId());
      const [epoch, nonce] = await Promise.all([
        client.readContract({ address: account, abi: accountAbi, functionName: "recoveryEpoch" }),
        client.readContract({ address: account, abi: accountAbi, functionName: "authorityNonce" }),
      ]);
      recoveryEpoch ??= epoch;
      authorityNonce ??= nonce;
    }
    if (chainId === undefined || recoveryEpoch === undefined || authorityNonce === undefined) {
      throw new Error("Pass --rpc, or pass --chain-id, --epoch, and --nonce.");
    }
    const built = await buildRecovery({
      mnemonic: required(args, "mnemonic"),
      accountIndex: Number(args.get("account-index") ?? "0"),
      account,
      chainId,
      newHotSigner: addressFlag(args, "new-hot"),
      newHotKeyType: Number(args.get("new-key-type") ?? "2") === 1 ? 1 : 2,
      recoveryEpoch,
      authorityNonce,
      deadline: BigInt(args.get("deadline") ?? String(Math.floor(Date.now() / 1000) + 86_400)),
      hardware: args.has("hardware"),
      passphrase: args.get("passphrase"),
    });
    if (!args.has("broadcast")) return built;
    const payerKey = required(args, "payer-key") as Hex;
    if (!rpc) throw new Error("--broadcast requires --rpc.");
    const hash = await broadcastRecovery({
      rpc,
      payerKey,
      account,
      request: {
        account: built.request.account,
        chainId: BigInt(built.request.chainId),
        newHotSigner: built.request.newHotSigner,
        newHotKeyType: built.request.newHotKeyType,
        nextRecoveryAuthority: built.request.nextRecoveryAuthority,
        recoveryEpoch: BigInt(built.request.recoveryEpoch),
        authorityNonce: BigInt(built.request.authorityNonce),
        deadline: BigInt(built.request.deadline),
      },
      signature: built.signature,
    });
    return { ...built, transaction: hash };
  }

  throw new Error("Commands: derive, predict, discover, recover, vectors");
}

function readFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) flags.set(name, "true");
    else {
      flags.set(name, next);
      i++;
    }
  }
  return flags;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value || value === "true") throw new Error(`Missing --${name}`);
  return value;
}

function addressFlag(args: Map<string, string>, name: string): Address {
  const value = required(args, name);
  if (!isAddress(value)) throw new Error(`--${name} is not an address.`);
  return getAddress(value);
}
