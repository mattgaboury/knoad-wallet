import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import type { Call } from "./types";

const APPROVE = "0x095ea7b3";
const SET_APPROVAL_FOR_ALL = "0xa22cb465";
const TRANSFER = "0xa9059cbb";
const TRANSFER_FROM = "0x23b872dd";
const SAFE_TRANSFER_FROM = "0x42842e0e";
const SAFE_TRANSFER_FROM_DATA = "0xb88d4fde";
const ERC1155_SAFE_TRANSFER = "0xf242432a";

const MAX_UINT = (1n << 256n) - 1n;

export const PERMISSION_ADVISORY =
  "Disconnecting a site does not revoke token or NFT permissions. Those stay in the other contracts until revoked there.";

export const UNLIMITED_APPROVAL_REFUSED =
  "This asks for an unlimited token allowance. KNOAD only approves the exact amount in the same transaction.";

export const COLLECTION_APPROVAL_REFUSED =
  "This asks to approve the whole NFT collection. KNOAD only approves one token.";

export type HeldApprovalNft = {
  contract: Address;
  tokenId: bigint;
  standard?: "erc721" | "erc1155";
};

type TokenId = { tokenId: bigint; standard: "erc721" | "erc1155" };

/** Append the leftover-permission line without repeating it. */
export function withPermissionAdvisory(message: string): string {
  if (message.includes(PERMISSION_ADVISORY)) return message;
  return `${message} ${PERMISSION_ADVISORY}`;
}

/**
 * Phone default before a site batch is signed. Unlimited ERC-20 approves become
 * the one amount spent in the same batch, or the batch is refused. A collection
 * operator grant becomes a single-token approve when that id is in the batch or
 * is the only one held, or the batch is refused. The account's creation policy
 * is not involved.
 */
export function narrowSiteApprovals(calls: Call[], held: HeldApprovalNft[] = []): Call[] {
  const spends = spendAmounts(calls);
  const ids = tokenIdsInBatch(calls);
  return calls.map((call) => rewriteCall(call, calls, spends, ids, held));
}

function rewriteCall(
  call: Call,
  calls: Call[],
  spends: Map<string, bigint | "mixed">,
  ids: Map<string, TokenId | "mixed">,
  held: HeldApprovalNft[],
): Call {
  const selector = call.data.slice(0, 10).toLowerCase();
  if (selector === APPROVE) {
    const decoded = decodeApprove(call);
    if (!decoded || !isUnlimited(decoded.amount)) return call;
    const token = getAddress(call.target);
    if (unlimitedCount(calls, token) > 1) throw new Error(UNLIMITED_APPROVAL_REFUSED);
    const spent = spends.get(token);
    if (spent === undefined || spent === "mixed") throw new Error(UNLIMITED_APPROVAL_REFUSED);
    return erc20Approve(call.target, decoded.spender, spent);
  }
  if (selector === SET_APPROVAL_FOR_ALL) {
    const decoded = decodeOperator(call);
    if (!decoded) throw new Error(COLLECTION_APPROVAL_REFUSED);
    if (!decoded.approved) return call;
    const id = singleToken(getAddress(call.target), ids, held);
    if (!id || id.standard === "erc1155") throw new Error(COLLECTION_APPROVAL_REFUSED);
    return erc721Approve(call.target, decoded.operator, id.tokenId);
  }
  return call;
}

function unlimitedCount(calls: Call[], token: Address): number {
  return calls.filter((call) => {
    if (getAddress(call.target) !== token) return false;
    const decoded = decodeApprove(call);
    return Boolean(decoded && isUnlimited(decoded.amount));
  }).length;
}

function isUnlimited(amount: bigint): boolean {
  return amount === MAX_UINT || amount === MAX_UINT - 1n;
}

function spendAmounts(calls: Call[]): Map<string, bigint | "mixed"> {
  const nftContracts = new Set(
    calls.filter((call) => isNftShaped(call.data.slice(0, 10).toLowerCase())).map((call) => getAddress(call.target)),
  );
  const amounts = new Map<string, bigint | "mixed">();
  for (const call of calls) {
    const selector = call.data.slice(0, 10).toLowerCase();
    const token = getAddress(call.target);
    let amount: bigint | null = null;
    if (selector === TRANSFER) amount = word(call.data, 1);
    else if (selector === TRANSFER_FROM && !nftContracts.has(token)) amount = word(call.data, 2);
    if (amount === null || amount <= 0n || isUnlimited(amount)) continue;
    const prior = amounts.get(token);
    if (prior === undefined) amounts.set(token, amount);
    else if (prior !== amount) amounts.set(token, "mixed");
  }
  return amounts;
}

function isNftShaped(selector: string): boolean {
  return (
    selector === SET_APPROVAL_FOR_ALL ||
    selector === SAFE_TRANSFER_FROM ||
    selector === SAFE_TRANSFER_FROM_DATA ||
    selector === ERC1155_SAFE_TRANSFER
  );
}

function tokenIdsInBatch(calls: Call[]): Map<string, TokenId | "mixed"> {
  const ids = new Map<string, TokenId | "mixed">();
  for (const call of calls) {
    const selector = call.data.slice(0, 10).toLowerCase();
    const found = tokenIdOf(call.data, selector);
    if (!found) continue;
    const key = getAddress(call.target);
    const prior = ids.get(key);
    if (prior === undefined) ids.set(key, found);
    else if (prior === "mixed" || prior.tokenId !== found.tokenId) ids.set(key, "mixed");
  }
  return ids;
}

function tokenIdOf(data: Hex, selector: string): TokenId | null {
  if (selector === SAFE_TRANSFER_FROM || selector === SAFE_TRANSFER_FROM_DATA || selector === TRANSFER_FROM) {
    const tokenId = word(data, 2);
    return tokenId === null ? null : { tokenId, standard: "erc721" };
  }
  if (selector === ERC1155_SAFE_TRANSFER) {
    const tokenId = word(data, 2);
    return tokenId === null ? null : { tokenId, standard: "erc1155" };
  }
  return null;
}

function singleToken(
  contract: Address,
  ids: Map<string, TokenId | "mixed">,
  held: HeldApprovalNft[],
): TokenId | null {
  const inBatch = ids.get(contract);
  if (inBatch === "mixed") return null;
  if (inBatch) return inBatch;
  const owned = held.filter((item) => getAddress(item.contract) === contract);
  if (owned.length !== 1) return null;
  const one = owned[0];
  if (!one) return null;
  return { tokenId: one.tokenId, standard: one.standard ?? "erc721" };
}

function decodeApprove(call: Call): { spender: Address; amount: bigint } | null {
  if (call.data.length !== 2 + 8 + 64 + 64) return null;
  const spender = addressWord(call.data, 0);
  const amount = word(call.data, 1);
  if (!spender || amount === null) return null;
  return { spender, amount };
}

function decodeOperator(call: Call): { operator: Address; approved: boolean } | null {
  if (call.data.length !== 2 + 8 + 64 + 64) return null;
  const operator = addressWord(call.data, 0);
  const flag = word(call.data, 1);
  if (!operator || (flag !== 0n && flag !== 1n)) return null;
  return { operator, approved: flag === 1n };
}

function erc20Approve(token: Address, spender: Address, amount: bigint): Call {
  return {
    target: getAddress(token),
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "approve",
      args: [spender, amount],
    }),
  };
}

function erc721Approve(token: Address, operator: Address, tokenId: bigint): Call {
  return {
    target: getAddress(token),
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "to", type: "address" },
            { name: "tokenId", type: "uint256" },
          ],
          outputs: [],
        },
      ],
      functionName: "approve",
      args: [operator, tokenId],
    }),
  };
}

function word(data: Hex, index: number): bigint | null {
  const start = 10 + index * 64;
  const end = start + 64;
  if (data.length < end) return null;
  return BigInt(`0x${data.slice(start, end)}`);
}

function addressWord(data: Hex, index: number): Address | null {
  const start = 10 + index * 64;
  const end = start + 64;
  if (data.length < end) return null;
  return getAddress(`0x${data.slice(start + 24, end)}`);
}
