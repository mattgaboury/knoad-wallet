import {
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  hashMessage,
  hashTypedData,
  keccak256,
  slice,
  toBytes,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BATCH_MODE,
  DOMAIN_NAME,
  DOMAIN_VERSION,
  ENTRY_POINT_V09,
  KEY_P256,
  KEY_SECP256K1,
  ZERO_POLICY,
  type Call,
  type KeyType,
  type PackedUserOperation,
  type Policy,
  type RecoveryRequest,
} from "./types";
import { defaultTestGas, type OperationGas } from "./operationGas";

const policyComponents = [
  { name: "periodLimit", type: "uint128" },
  { name: "windowSeconds", type: "uint64" },
  { name: "delaySeconds", type: "uint64" },
  { name: "delayThreshold", type: "uint128" },
  { name: "rejectUnlimitedApprovals", type: "bool" },
  { name: "recoveryDelay", type: "uint64" },
] as const;

export function encodePolicy(policy: Policy = ZERO_POLICY): Hex {
  return encodeAbiParameters(policyComponents, [
    policy.periodLimit,
    policy.windowSeconds,
    policy.delaySeconds,
    policy.delayThreshold,
    policy.rejectUnlimitedApprovals,
    policy.recoveryDelay,
  ]);
}

export function accountSalt(args: { recovery: Address; index: bigint; policy?: Policy }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [args.recovery, args.index, keccak256(encodePolicy(args.policy))],
    ),
  );
}

export function initializeCalldata(args: { recovery: Address; index?: bigint; policy?: Policy }): Hex {
  const policy = args.policy ?? ZERO_POLICY;
  return encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "initialize",
        inputs: [
          { name: "recoveryAuthority", type: "address" },
          { name: "index", type: "uint256" },
          { name: "policy", type: "tuple", components: [...policyComponents] },
        ],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ],
    functionName: "initialize",
    args: [args.recovery, args.index ?? 0n, policy],
  });
}

export function predictAccount(args: {
  factory: Address;
  implementation: Address;
  proxyCreationCode: Hex;
  recovery: Address;
  index?: bigint;
  policy?: Policy;
}): Address {
  const index = args.index ?? 0n;
  const initData = initializeCalldata({ recovery: args.recovery, index, policy: args.policy });
  const initCode = concat([
    args.proxyCreationCode,
    encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [args.implementation, initData]),
  ]);
  return getCreate2Address({
    from: args.factory,
    salt: accountSalt({ recovery: args.recovery, index, policy: args.policy }),
    bytecode: initCode,
  });
}

const activateTypes = {
  Activate: [
    { name: "account", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "initialSigner", type: "address" },
    { name: "keyType", type: "uint8" },
  ],
} as const;

/** Digest the epoch-0 recovery key signs so this chain can install its first spending key. */
export function activationDigest(args: {
  account: Address;
  chainId: bigint;
  initialSigner: Address;
  keyType: KeyType;
}): Hex {
  return hashTypedData({
    domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: args.chainId, verifyingContract: args.account },
    types: activateTypes,
    primaryType: "Activate",
    message: {
      account: args.account,
      chainId: args.chainId,
      initialSigner: args.initialSigner,
      keyType: args.keyType,
    },
  });
}

const executeAndRotateAbi = [
  {
    type: "function",
    name: "executeAndRotate",
    inputs: [
      { name: "mode", type: "bytes32" },
      { name: "executionData", type: "bytes" },
      { name: "nextSigner", type: "address" },
      { name: "nextKeyType", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

const executionBatch = [
  {
    type: "tuple[]",
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "callData", type: "bytes" },
    ],
  },
] as const;

export function encodeCalls(calls: Call[]): Hex {
  if (calls.length > 8) throw new Error("A batch is at most 8 calls.");
  return encodeAbiParameters(executionBatch, [calls.map((call) => ({ target: call.target, value: call.value, callData: call.data }))]);
}

/** The payments inside an executeAndRotate payload. Empty is a key refresh. Null is not that call. */
export function decodeExecuteCalls(callData: Hex): Call[] | null {
  if (!callData || callData === "0x") return [];
  try {
    const decoded = decodeFunctionData({ abi: executeAndRotateAbi, data: callData });
    const executionData = decoded.args[1];
    if (!executionData || executionData === "0x") return [];
    const [batch] = decodeAbiParameters(executionBatch, executionData);
    return batch.map((call) => ({ target: call.target, value: call.value, data: call.callData }));
  } catch {
    return null;
  }
}

export function executeAndRotateCalldata(args: {
  calls: Call[];
  nextSigner: Address;
  nextKeyType: KeyType;
}): Hex {
  if (args.nextSigner === zeroAddress) throw new Error("Next signer is zero.");
  // A zero-length execution payload is the key refresh. An encoded empty batch reverts.
  const executionData = args.calls.length === 0 ? "0x" : encodeCalls(args.calls);
  return encodeFunctionData({
    abi: executeAndRotateAbi,
    functionName: "executeAndRotate",
    args: [BATCH_MODE, executionData, args.nextSigner, args.nextKeyType],
  });
}

export function vetoCalldata(nextSigner: Address, nextKeyType: KeyType): Hex {
  return encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "vetoRecovery",
        inputs: [
          { name: "nextSigner", type: "address" },
          { name: "nextKeyType", type: "uint8" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ],
    functionName: "vetoRecovery",
    args: [nextSigner, nextKeyType],
  });
}

export function packUint128Pair(high: bigint, low: bigint): Hex {
  return encodePacked(["uint128", "uint128"], [high, low]);
}

export function userOpHash(
  op: Omit<PackedUserOperation, "signature">,
  chainId: bigint,
  entryPoint: Address = ENTRY_POINT_V09,
): Hex {
  return hashTypedData({
    domain: { name: "ERC4337", version: "1", chainId, verifyingContract: entryPoint },
    types: {
      PackedUserOperation: [
        { name: "sender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "initCode", type: "bytes" },
        { name: "callData", type: "bytes" },
        { name: "accountGasLimits", type: "bytes32" },
        { name: "preVerificationGas", type: "uint256" },
        { name: "gasFees", type: "bytes32" },
        { name: "paymasterAndData", type: "bytes" },
      ],
    },
    primaryType: "PackedUserOperation",
    message: {
      sender: op.sender,
      nonce: op.nonce,
      initCode: op.initCode,
      callData: op.callData,
      accountGasLimits: op.accountGasLimits,
      preVerificationGas: op.preVerificationGas,
      gasFees: op.gasFees,
      paymasterAndData: op.paymasterAndData,
    },
  });
}

export function buildUserOp(args: {
  sender: Address;
  nonce: bigint;
  callData: Hex;
  keyType?: KeyType;
  initCode?: Hex;
  gas?: OperationGas;
}): Omit<PackedUserOperation, "signature"> {
  const gas = args.gas ?? defaultTestGas(args.keyType);
  return {
    sender: args.sender,
    nonce: args.nonce,
    initCode: args.initCode ?? "0x",
    callData: args.callData,
    accountGasLimits: packUint128Pair(gas.verificationGasLimit, gas.callGasLimit),
    preVerificationGas: gas.preVerificationGas,
    gasFees: packUint128Pair(gas.maxPriorityFeePerGas, gas.maxFeePerGas),
    paymasterAndData: "0x",
  };
}

/** JSON a v0.9 bundler accepts. The on-chain hash still uses the packed fields. */
export function serializeUserOperation(op: PackedUserOperation) {
  const [verificationGasLimit, callGasLimit] = splitUint128(op.accountGasLimits);
  const [maxPriorityFeePerGas, maxFeePerGas] = splitUint128(op.gasFees);
  const deploying = op.initCode !== "0x";
  return {
    sender: op.sender,
    nonce: toQuantity(op.nonce),
    ...(deploying
      ? { factory: getAddress(slice(op.initCode, 0, 20)), factoryData: slice(op.initCode, 20) }
      : {}),
    callData: op.callData,
    callGasLimit: toQuantity(callGasLimit),
    verificationGasLimit: toQuantity(verificationGasLimit),
    preVerificationGas: toQuantity(op.preVerificationGas),
    maxFeePerGas: toQuantity(maxFeePerGas),
    maxPriorityFeePerGas: toQuantity(maxPriorityFeePerGas),
    signature: op.signature,
  };
}

export async function signSecp256k1(privateKey: Hex, digest: Hex): Promise<Hex> {
  return privateKeyToAccount(privateKey).sign({ hash: digest });
}

export function recoveryDigest(request: RecoveryRequest): Hex {
  return hashTypedData({
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: request.chainId,
      verifyingContract: request.account,
    },
    types: {
      Recovery: [
        { name: "account", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "newHotSigner", type: "address" },
        { name: "newHotKeyType", type: "uint8" },
        { name: "nextRecoveryAuthority", type: "address" },
        { name: "recoveryEpoch", type: "uint64" },
        { name: "authorityNonce", type: "uint64" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Recovery",
    message: request,
  });
}

/**
 * Mnemonic clients must pass the next derived authority.
 * A hardware wallet with one key passes the zero address and keeps it.
 */
export function buildRecoveryRequest(args: {
  account: Address;
  chainId: bigint;
  newHotSigner: Address;
  newHotKeyType: KeyType;
  nextRecoveryAuthority: Address;
  recoveryEpoch: bigint;
  authorityNonce: bigint;
  deadline: bigint;
  mnemonicClient?: boolean;
}): RecoveryRequest {
  if (args.mnemonicClient && getAddress(args.nextRecoveryAuthority) === zeroAddress) {
    throw new Error("Mnemonic recovery must name the next derived authority.");
  }
  if (args.newHotSigner === zeroAddress) throw new Error("New hot signer is zero.");
  return { ...args };
}

/** Digest the current hot key signs for ERC-7739 personal_sign. */
export function personalSignDigest(account: Address, chainId: bigint, message: string): Hex {
  const domainType = keccak256(
    toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
  );
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [domainType, keccak256(toBytes(DOMAIN_NAME)), keccak256(toBytes(DOMAIN_VERSION)), chainId, account],
    ),
  );
  const structHash = keccak256(concat([keccak256(toBytes("PersonalSign(bytes prefixed)")), hashMessage(message)]));
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

export const ACCOUNT_CREATED_EVENT =
  "event AccountCreated(address indexed recoveryAuthority, address indexed account, address initialHotSigner, uint256 index)";

export function accountInitCode(args: {
  factory: Address;
  recovery: Address;
  index?: bigint;
  initialSigner: Address;
  keyType?: KeyType;
  signature: Hex;
}): Hex {
  const data = encodeFunctionData({
    abi: factoryAbi,
    functionName: "createAccount",
    args: [
      args.recovery,
      args.index ?? 0n,
      {
        initialSigner: args.initialSigner,
        keyType: args.keyType ?? KEY_SECP256K1,
        signature: args.signature,
      },
    ],
  });
  return concat([args.factory, data]);
}

export const factoryAbi = [
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recoveryAuthority", type: "address" },
      { name: "index", type: "uint256" },
      {
        name: "activation",
        type: "tuple",
        components: [
          { name: "initialSigner", type: "address" },
          { name: "keyType", type: "uint8" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "predict",
    stateMutability: "view",
    inputs: [
      { name: "recoveryAuthority", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

export const accountAbi = [
  {
    type: "function",
    name: "recover",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "account", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "newHotSigner", type: "address" },
          { name: "newHotKeyType", type: "uint8" },
          { name: "nextRecoveryAuthority", type: "address" },
          { name: "recoveryEpoch", type: "uint64" },
          { name: "authorityNonce", type: "uint64" },
          { name: "deadline", type: "uint64" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recoveryAuthority",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "recoveryEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "authorityNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "generation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "hotSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "spendPolicy",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "periodLimit", type: "uint128" },
      { name: "windowSeconds", type: "uint64" },
      { name: "delaySeconds", type: "uint64" },
      { name: "delayThreshold", type: "uint128" },
      { name: "rejectUnlimitedApprovals", type: "bool" },
      { name: "spent", type: "uint128" },
    ],
  },
] as const;

export function bytes32FromUint(value: bigint): Hex {
  return toHex(value, { size: 32 });
}

function splitUint128(packed: Hex): readonly [bigint, bigint] {
  const body = packed.slice(2).padStart(64, "0");
  return [BigInt(`0x${body.slice(0, 32)}`), BigInt(`0x${body.slice(32)}`)];
}

function toQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}
