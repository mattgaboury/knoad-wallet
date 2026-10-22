import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { assertSessionHasNoKeyMaterial, describeDecision, routeSessionRequest } from "./session";
import {
  describeWethOffer,
  orderGrantCall,
  orderRevokeCall,
  readWethOffer,
  SEAPORT_15,
  SEAPORT_16,
} from "./seaport";
import type { TypedDataRequest } from "./typedData";

const ACCOUNT = getAddress("0x00000000000000000000000000000000000000aa");
const NFT = getAddress("0x00000000000000000000000000000000000000bb");
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const FEE = getAddress("0x00000000000000000000000000000000000000cc");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const BASE_WETH = getAddress("0x4200000000000000000000000000000000000006");

const TYPES = {
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "counter", type: "uint256" },
  ],
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};

function order(patch: {
  offerer?: Address;
  offer?: Record<string, unknown>[];
  consideration?: Record<string, unknown>[];
  endTime?: bigint;
  version?: string;
  verifyingContract?: Address;
  chainId?: number;
  primaryType?: string;
} = {}): TypedDataRequest {
  const end = patch.endTime ?? BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
  const version = patch.version ?? "1.6";
  const chainId = patch.chainId ?? 1;
  const weth = chainId === 8453 ? BASE_WETH : WETH;
  return {
    types: TYPES,
    primaryType: patch.primaryType ?? "OrderComponents",
    domain: {
      name: "Seaport",
      version,
      chainId,
      verifyingContract: patch.verifyingContract ?? (version === "1.5" ? SEAPORT_15 : SEAPORT_16),
    },
    message: {
      offerer: patch.offerer ?? ACCOUNT,
      zone: zeroAddress,
      offer: patch.offer ?? [
        { itemType: 1, token: weth, identifierOrCriteria: "0", startAmount: (5n * 10n ** 17n).toString(), endAmount: (5n * 10n ** 17n).toString() },
      ],
      consideration: patch.consideration ?? [
        { itemType: 2, token: NFT, identifierOrCriteria: "123", startAmount: "1", endAmount: "1", recipient: patch.offerer ?? ACCOUNT },
        { itemType: 1, token: weth, identifierOrCriteria: "0", startAmount: "12500000000000000", endAmount: "12500000000000000", recipient: FEE },
      ],
      orderType: 0,
      startTime: "0",
      endTime: end.toString(),
      zoneHash: `0x${"00".repeat(32)}`,
      salt: "1",
      conduitKey: `0x${"11".repeat(32)}`,
      counter: "0",
    },
  };
}

test("a WETH offer is one exact Seaport order", () => {
  const request = order();
  const offer = readWethOffer(request, ACCOUNT, 1);
  assert.ok(offer);
  assert.equal(offer.verifier, SEAPORT_16);
  assert.equal(offer.wethAmount, 5n * 10n ** 17n);
  assert.equal(offer.nft.contract, NFT);
  assert.equal(offer.nft.tokenId, 123n);
  assert.equal(offer.digest, readWethOffer(request, ACCOUNT, 1)?.digest);
  const described = describeWethOffer(offer);
  assert.match(described.summary, /^Offer 0\.5 WETH for Collection #123, ends /);
  const grant = orderGrantCall(ACCOUNT, offer);
  assert.equal(grant.target, ACCOUNT);
  assert.equal(grant.value, 0n);
  const decoded = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "approveOrderDigest",
        stateMutability: "nonpayable",
        inputs: [
          { name: "digest", type: "bytes32" },
          { name: "verifier", type: "address" },
          { name: "expiry", type: "uint64" },
        ],
        outputs: [],
      },
    ],
    data: grant.data,
  });
  assert.equal(decoded.args[0], offer.digest);
  assert.equal(decoded.args[1], SEAPORT_16);
  assert.equal(decoded.args[2], offer.expiry);
  const revoke = orderRevokeCall(ACCOUNT, offer.digest);
  assert.equal(revoke.target, ACCOUNT);
  assert.match(revoke.data, /^0x/);

  const decision = routeSessionRequest({
    method: "eth_signTypedData_v4",
    account: ACCOUNT,
    chainId: 8453,
    origin: "https://opensea.io",
    params: [ACCOUNT, request],
  });
  assert.equal(decision.kind, "sign-typed-data");
  if (decision.kind === "sign-typed-data") {
    assert.equal(decision.summary, described.summary);
    assert.equal(decision.offer?.amount, "0.5");
    assert.equal(decision.offer?.nft, "Collection #123");
    assertSessionHasNoKeyMaterial(decision);
    assert.match(describeDecision(decision, "Ethereum"), /Offer 0\.5 WETH/);
  }
});

test("a collection offer has no single token id", () => {
  const request = order({
    consideration: [
      { itemType: 4, token: NFT, identifierOrCriteria: "99", startAmount: "1", endAmount: "1", recipient: ACCOUNT },
    ],
  });
  const offer = readWethOffer(request, ACCOUNT, 1);
  assert.ok(offer);
  assert.equal(offer.nft.tokenId, null);
  assert.match(describeWethOffer(offer).summary, /for a collection, ends /);
});

test("Seaport 1.5 on Base is an allowlisted verifier", () => {
  const request = order({ version: "1.5", chainId: 8453 });
  const offer = readWethOffer(request, ACCOUNT, 8453);
  assert.equal(offer?.verifier, SEAPORT_15);
});

test("offers that are not a WETH bid are left unsigned by a grant", () => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const cases: TypedDataRequest[] = [
    order({ offerer: FEE }),
    order({ offer: [{ itemType: 1, token: USDC, identifierOrCriteria: "0", startAmount: "1", endAmount: "1" }] }),
    order({ verifyingContract: ACCOUNT }),
    order({
      offer: [{ itemType: 2, token: NFT, identifierOrCriteria: "123", startAmount: "1", endAmount: "1" }],
      consideration: [{ itemType: 1, token: WETH, identifierOrCriteria: "0", startAmount: "1", endAmount: "1", recipient: FEE }],
    }),
    order({ primaryType: "BulkOrder" }),
    order({ endTime: now - 10n }),
    order({ endTime: now + 181n * 24n * 60n * 60n }),
  ];
  for (const request of cases) assert.equal(readWethOffer(request, ACCOUNT, 1), null);
});

test("a revoke call names the order digest", () => {
  const digest = `0x${"ab".repeat(32)}` as Hex;
  const call = orderRevokeCall(ACCOUNT, digest);
  const decoded = decodeFunctionData({
    abi: [
      {
        type: "function",
        name: "revokeOrderDigest",
        stateMutability: "nonpayable",
        inputs: [{ name: "digest", type: "bytes32" }],
        outputs: [],
      },
    ],
    data: call.data,
  });
  assert.equal(decoded.args[0], digest);
});
