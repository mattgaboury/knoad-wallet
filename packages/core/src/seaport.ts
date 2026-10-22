import { encodeFunctionData, getAddress, hashTypedData, isAddress, type Address, type Hex } from "viem";
import { formatUnits, LISTED_TOKENS } from "./commerce";
import type { TypedDataField, TypedDataRequest } from "./typedData";
import type { Call } from "./types";

/** Canonical Seaport deployments. The same CREATE2 address is used on Ethereum and Base. */
export const SEAPORT_15 = getAddress("0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC");
export const SEAPORT_16 = getAddress("0x0000000000000068F116a894984e2DB1123eB395");

const SEAPORT_BY_VERSION: Record<string, Address> = {
  "1.5": SEAPORT_15,
  "1.6": SEAPORT_16,
};

export const SEAPORT_ADDRESSES: Record<number, readonly Address[]> = {
  1: [SEAPORT_15, SEAPORT_16],
  8453: [SEAPORT_15, SEAPORT_16],
};

const MAX_OFFER_SECONDS = 180n * 24n * 60n * 60n;
const ERC20 = 1;
const ERC721 = 2;
const ERC1155 = 3;
const ERC721_CRITERIA = 4;
const ERC1155_CRITERIA = 5;

const OFFER_FIELDS: readonly TypedDataField[] = [
  { name: "itemType", type: "uint8" },
  { name: "token", type: "address" },
  { name: "identifierOrCriteria", type: "uint256" },
  { name: "startAmount", type: "uint256" },
  { name: "endAmount", type: "uint256" },
];

const CONSIDERATION_FIELDS: readonly TypedDataField[] = [
  ...OFFER_FIELDS,
  { name: "recipient", type: "address" },
];

const ORDER_FIELDS: readonly TypedDataField[] = [
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
];

const SEAPORT_TYPES = {
  OfferItem: OFFER_FIELDS,
  ConsiderationItem: CONSIDERATION_FIELDS,
  OrderComponents: ORDER_FIELDS,
} as const;

const GRANT_ABI = [
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
] as const;

const REVOKE_ABI = [
  {
    type: "function",
    name: "revokeOrderDigest",
    stateMutability: "nonpayable",
    inputs: [{ name: "digest", type: "bytes32" }],
    outputs: [],
  },
] as const;

export const OFFER_NOT_SAVED = "This offer stops working after your next transaction.";

export type WethOfferNft = {
  contract: Address;
  /** Null when the offer can match any item in the collection. */
  tokenId: bigint | null;
};

export type WethOffer = {
  digest: Hex;
  verifier: Address;
  expiry: bigint;
  wethAmount: bigint;
  nft: WethOfferNft;
};

type OfferItem = {
  itemType: number;
  token: Address;
  identifierOrCriteria: bigint;
  startAmount: bigint;
  endAmount: bigint;
};

type ConsiderationItem = OfferItem & { recipient: Address };

/**
 * A WETH bid this account can register. Anything else, including NFT listings
 * and bulk orders, returns null and keeps a normal signature with no grant.
 */
export function readWethOffer(typedData: TypedDataRequest, account: Address, chainId: number, now = unixNow()): WethOffer | null {
  if (typedData.primaryType !== "OrderComponents") return null;
  if (!fieldsMatch(typedData.types.OfferItem, OFFER_FIELDS)) return null;
  if (!fieldsMatch(typedData.types.ConsiderationItem, CONSIDERATION_FIELDS)) return null;
  if (!fieldsMatch(typedData.types.OrderComponents, ORDER_FIELDS)) return null;

  const domain = typedData.domain;
  if (domain.name !== "Seaport") return null;
  const verifier = SEAPORT_BY_VERSION[domain.version ?? ""];
  if (!verifier) return null;
  if (!isAddress(domain.verifyingContract ?? "") || getAddress(domain.verifyingContract as string) !== verifier) return null;
  if (!SEAPORT_ADDRESSES[chainId]?.includes(verifier)) return null;
  if (domainChain(domain.chainId) !== chainId) return null;

  const message = typedData.message;
  const offerer = asAddress(message.offerer);
  if (!offerer || offerer !== getAddress(account)) return null;
  const zone = asAddress(message.zone);
  const orderType = asUint8(message.orderType);
  const startTime = asUint(message.startTime);
  const endTime = asUint(message.endTime);
  const zoneHash = asBytes32(message.zoneHash);
  const salt = asUint(message.salt);
  const conduitKey = asBytes32(message.conduitKey);
  const counter = asUint(message.counter);
  if (!zone || orderType === null || startTime === null || endTime === null || !zoneHash || salt === null || !conduitKey || counter === null) {
    return null;
  }
  if (endTime <= now || endTime > now + MAX_OFFER_SECONDS || endTime > 2n ** 64n - 1n) return null;

  const weth = wethOn(chainId);
  if (!weth) return null;
  const offer = readItems(message.offer, false);
  if (!offer || offer.length === 0) return null;
  let wethAmount = 0n;
  for (const item of offer) {
    if (item.itemType !== ERC20 || item.token !== weth || item.identifierOrCriteria !== 0n) return null;
    const amount = item.startAmount > item.endAmount ? item.startAmount : item.endAmount;
    if (amount === 0n) return null;
    wethAmount += amount;
  }

  const consideration = readItems(message.consideration, true);
  if (!consideration || consideration.length === 0) return null;
  let nft: WethOfferNft | null = null;
  for (const item of consideration) {
    if (!("recipient" in item)) return null;
    if (isNft(item.itemType)) {
      if (item.recipient !== offerer) return null;
      if ((item.itemType === ERC721 || item.itemType === ERC721_CRITERIA) && (item.startAmount !== 1n || item.endAmount !== 1n)) return null;
      if ((item.itemType === ERC1155 || item.itemType === ERC1155_CRITERIA) && item.startAmount === 0n && item.endAmount === 0n) return null;
      if (!nft) {
        nft = {
          contract: item.token,
          tokenId: item.itemType === ERC721 || item.itemType === ERC1155 ? item.identifierOrCriteria : null,
        };
      }
      continue;
    }
    if (item.itemType !== ERC20 || item.token !== weth || item.identifierOrCriteria !== 0n) return null;
  }
  if (!nft) return null;

  // This is the EIP-712 digest Seaport passes to isValidSignature, not the bare getOrderHash.
  const digest = hashTypedData({
    domain: { name: "Seaport", version: domain.version, chainId: BigInt(chainId), verifyingContract: verifier },
    types: SEAPORT_TYPES,
    primaryType: "OrderComponents",
    message: {
      offerer,
      zone,
      offer: offer.map(hashItem),
      consideration: consideration.map((item) => ({ ...hashItem(item), recipient: item.recipient })),
      orderType,
      startTime,
      endTime,
      zoneHash,
      salt,
      conduitKey,
      counter,
    },
  });

  return { digest, verifier, expiry: endTime, wethAmount, nft };
}

export function describeWethOffer(offer: WethOffer): { amount: string; nft: string; ends: string; summary: string } {
  const amount = formatUnits(offer.wethAmount, 18);
  const nft = offer.nft.tokenId === null ? "a collection" : `Collection #${offer.nft.tokenId.toString()}`;
  const ends = formatEnds(offer.expiry);
  return { amount, nft, ends, summary: `Offer ${amount} WETH for ${nft}, ends ${ends}` };
}

export function orderGrantCall(account: Address, offer: WethOffer): Call {
  return {
    target: getAddress(account),
    value: 0n,
    data: encodeFunctionData({
      abi: GRANT_ABI,
      functionName: "approveOrderDigest",
      args: [offer.digest, offer.verifier, offer.expiry],
    }),
  };
}

export function orderRevokeCall(account: Address, digest: Hex): Call {
  return {
    target: getAddress(account),
    value: 0n,
    data: encodeFunctionData({
      abi: REVOKE_ABI,
      functionName: "revokeOrderDigest",
      args: [digest],
    }),
  };
}

function hashItem(item: OfferItem) {
  return {
    itemType: item.itemType,
    token: item.token,
    identifierOrCriteria: item.identifierOrCriteria,
    startAmount: item.startAmount,
    endAmount: item.endAmount,
  };
}

function readItems(value: unknown, withRecipient: boolean): ConsiderationItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: ConsiderationItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const itemType = asUint8(row.itemType);
    const token = asAddress(row.token);
    const identifierOrCriteria = asUint(row.identifierOrCriteria);
    const startAmount = asUint(row.startAmount);
    const endAmount = asUint(row.endAmount);
    if (itemType === null || !token || identifierOrCriteria === null || startAmount === null || endAmount === null) return null;
    const recipient = withRecipient ? asAddress(row.recipient) : getAddress("0x0000000000000000000000000000000000000001");
    if (!recipient) return null;
    items.push({ itemType, token, identifierOrCriteria, startAmount, endAmount, recipient });
  }
  return items;
}

function isNft(itemType: number): boolean {
  return itemType === ERC721 || itemType === ERC1155 || itemType === ERC721_CRITERIA || itemType === ERC1155_CRITERIA;
}

function wethOn(chainId: number): Address | null {
  return LISTED_TOKENS.find((token) => token.chainId === chainId && token.symbol === "WETH")?.address ?? null;
}

function fieldsMatch(got: readonly TypedDataField[] | undefined, expected: readonly TypedDataField[]): boolean {
  if (!got || got.length !== expected.length) return false;
  return expected.every((field, index) => got[index]?.name === field.name && got[index]?.type === field.type);
}

function asAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value)) return null;
  return getAddress(value);
}

function asUint(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function asUint8(value: unknown): number | null {
  const parsed = asUint(value);
  if (parsed === null || parsed > 255n) return null;
  return Number(parsed);
}

function asBytes32(value: unknown): Hex | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  return value as Hex;
}

function domainChain(value: unknown): number | null {
  const parsed = asUint(value);
  if (parsed === null || parsed === 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(parsed);
}

function unixNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

function formatEnds(expiry: bigint): string {
  const date = new Date(Number(expiry) * 1000);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return year === new Date().getUTCFullYear() ? `${month} ${day}` : `${month} ${day}, ${year}`;
}
