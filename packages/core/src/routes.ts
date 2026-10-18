import {
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

/** 0x Settler registry. `ownerOf(2)` is the current taker-submitted Settler, `prev(2)` the one before. */
export const ZEROX_REGISTRY = getAddress("0x00000000000004533Fe15556B1E086BB1A72cEae");
export const SETTLER_TAKER_FEATURE = 2n;

const NATIVE = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

const holderAbi = [
  {
    type: "function",
    name: "exec",
    stateMutability: "payable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "bytes" }],
  },
] as const;

const settlerAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      {
        name: "slippage",
        type: "tuple",
        components: [
          { name: "recipient", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "minAmountOut", type: "uint256" },
        ],
      },
      { name: "actions", type: "bytes[]" },
      { name: "zid", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const registryAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "prev", stateMutability: "view", inputs: [{ name: "featureId", type: "uint128" }], outputs: [{ type: "address" }] },
] as const;

const swapData = [
  { name: "callTo", type: "address" },
  { name: "approveTo", type: "address" },
  { name: "sendingAssetId", type: "address" },
  { name: "receivingAssetId", type: "address" },
  { name: "fromAmount", type: "uint256" },
  { name: "callData", type: "bytes" },
  { name: "requiresDeposit", type: "bool" },
] as const;

const bridgeData = [
  { name: "transactionId", type: "bytes32" },
  { name: "bridge", type: "string" },
  { name: "integrator", type: "string" },
  { name: "referrer", type: "address" },
  { name: "sendingAssetId", type: "address" },
  { name: "receiver", type: "address" },
  { name: "minAmount", type: "uint256" },
  { name: "destinationChainId", type: "uint256" },
  { name: "hasSourceSwaps", type: "bool" },
  { name: "hasDestinationCall", type: "bool" },
] as const;

const swapHead = [
  { name: "transactionId", type: "bytes32" },
  { name: "integrator", type: "string" },
  { name: "referrer", type: "string" },
  { name: "receiver", type: "address" },
  { name: "minAmountOut", type: "uint256" },
] as const;

/** LI.FI GenericSwapFacetV3. Everything else on the Diamond is read as a bridge. */
const lifiSwapAbi = [
  ...(["swapTokensSingleV3ERC20ToERC20", "swapTokensSingleV3ERC20ToNative", "swapTokensSingleV3NativeToERC20"] as const).map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "payable" as const,
    inputs: [...swapHead, { name: "swapData", type: "tuple" as const, components: swapData }],
    outputs: [],
  })),
  ...(["swapTokensMultipleV3ERC20ToERC20", "swapTokensMultipleV3ERC20ToNative", "swapTokensMultipleV3NativeToERC20"] as const).map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "payable" as const,
    inputs: [...swapHead, { name: "swapData", type: "tuple[]" as const, components: swapData }],
    outputs: [],
  })),
];

const LIFI_SWAP_SELECTORS = new Set(lifiSwapAbi.map((item) => toFunctionSelector(item)));

type SwapStep = { sendingAssetId: Address; receivingAssetId: Address; fromAmount: bigint };

export type RouteExpectation = {
  provider: "0x" | "lifi";
  account: Address;
  chainId: number;
  destinationChainId: number;
  sellToken: Address;
  sellNative: boolean;
  buyToken: Address;
  sellAmount: bigint;
  minBuyAmount: bigint;
};

/**
 * Reads the provider calldata itself, so the receiver, tokens, and minimum are
 * not taken from the quote service. Returns the 0x Settler the phone must check
 * against the registry before signing.
 */
export function checkRouteCalldata(data: Hex, expect: RouteExpectation): { settler: Address | null } {
  if (expect.provider === "0x") return { settler: checkZeroEx(data, expect) };
  checkLiFi(data, expect);
  return { settler: null };
}

function checkZeroEx(data: Hex, expect: RouteExpectation): Address {
  if (expect.chainId !== expect.destinationChainId) throw new Error("0x quotes are same-chain only.");
  let exec;
  try {
    exec = decodeFunctionData({ abi: holderAbi, data });
  } catch {
    throw new Error("Could not read the 0x route.");
  }
  const [operator, token, amount, target, inner] = exec.args;
  const settler = getAddress(target);
  if (getAddress(operator) !== settler) throw new Error("The 0x route gives the allowance to a different contract than it calls.");
  if (settler === zeroAddress || settler === getAddress(expect.account)) throw new Error("The 0x route calls an invalid contract.");
  if (expect.sellNative) {
    if (asset(token) !== NATIVE) throw new Error("The 0x route moves a token on a native sale.");
  } else if (asset(token) !== expect.sellToken || amount !== expect.sellAmount) {
    throw new Error("The 0x route moves a different token or amount than the quote shows.");
  }
  let execute;
  try {
    execute = decodeFunctionData({ abi: settlerAbi, data: inner });
  } catch {
    throw new Error("Could not read the 0x Settler call.");
  }
  const [slippage] = execute.args;
  if (getAddress(slippage.recipient) !== getAddress(expect.account)) throw new Error("The 0x route pays someone other than this account.");
  if (asset(slippage.buyToken) !== expect.buyToken) throw new Error("The 0x route buys a different token than the quote shows.");
  if (slippage.minAmountOut < expect.minBuyAmount) throw new Error("The 0x route accepts less than the quoted minimum.");
  return settler;
}

function checkLiFi(data: Hex, expect: RouteExpectation): void {
  if (data.length >= 10 && LIFI_SWAP_SELECTORS.has(data.slice(0, 10) as Hex)) {
    if (expect.chainId !== expect.destinationChainId) throw new Error("A LI.FI swap cannot bridge.");
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: lifiSwapAbi, data });
    } catch {
      throw new Error("Could not read the LI.FI swap.");
    }
    const [, , , receiver, minAmountOut, steps] = decoded.args as unknown as [Hex, string, string, Address, bigint, SwapStep | SwapStep[]];
    const list = Array.isArray(steps) ? steps : [steps];
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) throw new Error("The LI.FI swap has no steps.");
    if (getAddress(receiver) !== getAddress(expect.account)) throw new Error("The LI.FI route pays someone other than this account.");
    if (minAmountOut < expect.minBuyAmount) throw new Error("The LI.FI route accepts less than the quoted minimum.");
    checkSource(first.sendingAssetId, first.fromAmount, expect);
    if (asset(last.receivingAssetId) !== expect.buyToken) throw new Error("The LI.FI route buys a different token than the quote shows.");
    return;
  }
  if (expect.chainId === expect.destinationChainId) throw new Error("The LI.FI route is not a swap this app can read.");
  let bridge;
  try {
    [bridge] = decodeAbiParameters([{ type: "tuple", components: bridgeData }], `0x${data.slice(10)}`);
  } catch {
    throw new Error("Could not read the LI.FI bridge.");
  }
  if (getAddress(bridge.receiver) !== getAddress(expect.account)) throw new Error("The LI.FI bridge pays someone other than this account.");
  if (bridge.destinationChainId !== BigInt(expect.destinationChainId)) throw new Error("The LI.FI bridge goes to a different chain.");
  if (bridge.hasDestinationCall) throw new Error("The LI.FI bridge runs a call on arrival, which this app does not allow.");
  if (bridge.hasSourceSwaps) {
    let steps;
    try {
      [, steps] = decodeAbiParameters([{ type: "tuple", components: bridgeData }, { type: "tuple[]", components: swapData }], `0x${data.slice(10)}`);
    } catch {
      throw new Error("Could not read the LI.FI bridge swaps.");
    }
    const first = steps[0];
    if (!first) throw new Error("The LI.FI bridge has no source swap.");
    checkSource(first.sendingAssetId, first.fromAmount, expect);
    return;
  }
  checkSource(bridge.sendingAssetId, bridge.minAmount, expect);
}

function checkSource(token: Address, amount: bigint, expect: RouteExpectation): void {
  if (asset(token) !== expect.sellToken) throw new Error("The LI.FI route spends a different token than the quote shows.");
  if (amount > expect.sellAmount) throw new Error("The LI.FI route spends more than the quote shows.");
}

function asset(token: Address): Address {
  const address = getAddress(token);
  return address === zeroAddress ? NATIVE : address;
}

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** 0x rotates Settler, so it is checked on-chain instead of pinned. A paused registry refuses. */
export async function requireGenuineSettler(rpc: Rpc, settler: Address): Promise<void> {
  const read = async (functionName: "ownerOf" | "prev") => {
    const result = (await rpc("eth_call", [
      { to: ZEROX_REGISTRY, data: encodeFunctionData({ abi: registryAbi, functionName, args: [SETTLER_TAKER_FEATURE] }) },
      "latest",
    ])) as Hex;
    return getAddress(decodeFunctionResult({ abi: registryAbi, functionName, data: result }));
  };
  let current: Address;
  try {
    current = await read("ownerOf");
  } catch {
    throw new Error("0x Settler is paused or the registry could not be read. Nothing was signed.");
  }
  if (current === getAddress(settler)) return;
  let previous: Address | null = null;
  try {
    previous = await read("prev");
  } catch {
    previous = null;
  }
  if (previous === getAddress(settler)) return;
  throw new Error("The 0x quote calls a Settler the 0x registry does not name. Nothing was signed.");
}

export function encodeZeroExExec(args: {
  settler: Address;
  token: Address;
  amount: bigint;
  recipient: Address;
  buyToken: Address;
  minAmountOut: bigint;
}): Hex {
  const inner = encodeFunctionData({
    abi: settlerAbi,
    functionName: "execute",
    args: [{ recipient: args.recipient, buyToken: args.buyToken, minAmountOut: args.minAmountOut }, [], `0x${"00".repeat(32)}`],
  });
  return encodeFunctionData({ abi: holderAbi, functionName: "exec", args: [args.settler, args.token, args.amount, args.settler, inner] });
}

export function encodeLiFiSwap(args: {
  receiver: Address;
  minAmountOut: bigint;
  sendingAssetId: Address;
  receivingAssetId: Address;
  fromAmount: bigint;
}): Hex {
  return encodeFunctionData({
    abi: lifiSwapAbi,
    functionName: "swapTokensSingleV3ERC20ToERC20",
    args: [
      `0x${"11".repeat(32)}`,
      "knoad",
      "",
      args.receiver,
      args.minAmountOut,
      {
        callTo: args.receiver,
        approveTo: args.receiver,
        sendingAssetId: args.sendingAssetId,
        receivingAssetId: args.receivingAssetId,
        fromAmount: args.fromAmount,
        callData: "0x",
        requiresDeposit: true,
      },
    ],
  } as never);
}

export function encodeLiFiBridge(args: {
  receiver: Address;
  sendingAssetId: Address;
  minAmount: bigint;
  destinationChainId: number;
  hasDestinationCall?: boolean;
}): Hex {
  const head = encodeAbiParameters(
    [{ type: "tuple", components: bridgeData }],
    [
      {
        transactionId: `0x${"22".repeat(32)}`,
        bridge: "across",
        integrator: "knoad",
        referrer: zeroAddress,
        sendingAssetId: args.sendingAssetId,
        receiver: args.receiver,
        minAmount: args.minAmount,
        destinationChainId: BigInt(args.destinationChainId),
        hasSourceSwaps: false,
        hasDestinationCall: args.hasDestinationCall ?? false,
      },
    ],
  );
  return `0x8bf6ef99${head.slice(2)}` as Hex;
}
