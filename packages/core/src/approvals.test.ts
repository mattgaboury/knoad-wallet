import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import {
  COLLECTION_APPROVAL_REFUSED,
  narrowSiteApprovals,
  PERMISSION_ADVISORY,
  UNLIMITED_APPROVAL_REFUSED,
  withPermissionAdvisory,
  ZERO_POLICY,
  type Call,
} from "./index";

const TOKEN = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const NFT = getAddress("0x00000000000000000000000000000000000000a1");
const SPENDER = getAddress("0x00000000000000000000000000000000000000b2");
const OPERATOR = getAddress("0x00000000000000000000000000000000000000c3");
const RECEIVER = getAddress("0x00000000000000000000000000000000000000d4");
const MAX = (1n << 256n) - 1n;

const erc20Approve = {
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ type: "bool" }],
} as const;

const erc20Transfer = {
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ type: "bool" }],
} as const;

const setApprovalForAll = {
  type: "function",
  name: "setApprovalForAll",
  stateMutability: "nonpayable",
  inputs: [
    { name: "operator", type: "address" },
    { name: "approved", type: "bool" },
  ],
  outputs: [],
} as const;

const erc721Approve = {
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" },
    { name: "tokenId", type: "uint256" },
  ],
  outputs: [],
} as const;

const safeTransfer = {
  type: "function",
  name: "safeTransferFrom",
  stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "tokenId", type: "uint256" },
  ],
  outputs: [],
} as const;

const encode = encodeFunctionData as (args: {
  abi: readonly object[];
  functionName: string;
  args?: readonly unknown[];
}) => Hex;

function call(target: Address, abi: { readonly name: string }, args: readonly unknown[]): Call {
  return { target, value: 0n, data: encode({ abi: [abi], functionName: abi.name, args }) };
}

function approvedAmount(data: Hex): bigint {
  const decoded = decodeFunctionData({ abi: [erc20Approve], data });
  return decoded.args[1];
}

test("creation policy stays empty so existing addresses do not move", () => {
  assert.equal(ZERO_POLICY.rejectUnlimitedApprovals, false);
  assert.equal(ZERO_POLICY.recoveryDelay, 0n);
});

test("an exact approve is left alone", () => {
  const calls = [call(TOKEN, erc20Approve, [SPENDER, 25n])];
  const next = narrowSiteApprovals(calls);
  assert.equal(next[0]?.data, calls[0]?.data);
});

test("an unlimited approve becomes the amount spent in the same batch", () => {
  const next = narrowSiteApprovals([
    call(TOKEN, erc20Approve, [SPENDER, MAX]),
    call(TOKEN, erc20Transfer, [RECEIVER, 40n]),
  ]);
  assert.equal(approvedAmount(next[0]?.data ?? "0x"), 40n);
  assert.equal(next[1]?.data, call(TOKEN, erc20Transfer, [RECEIVER, 40n]).data);
});

test("a max-minus-one allowance is treated as unlimited", () => {
  assert.throws(
    () => narrowSiteApprovals([call(TOKEN, erc20Approve, [SPENDER, MAX - 1n])]),
    new RegExp(UNLIMITED_APPROVAL_REFUSED),
  );
});

test("an unlimited approve with no spend in the batch is refused", () => {
  assert.throws(() => narrowSiteApprovals([call(TOKEN, erc20Approve, [SPENDER, MAX])]), new RegExp(UNLIMITED_APPROVAL_REFUSED));
});

test("two different spend amounts do not pick a winner", () => {
  assert.throws(
    () =>
      narrowSiteApprovals([
        call(TOKEN, erc20Approve, [SPENDER, MAX]),
        call(TOKEN, erc20Transfer, [RECEIVER, 1n]),
        call(TOKEN, erc20Transfer, [OPERATOR, 2n]),
      ]),
    new RegExp(UNLIMITED_APPROVAL_REFUSED),
  );
});

test("a collection grant becomes the token id moved in the same batch", () => {
  const next = narrowSiteApprovals([
    call(NFT, setApprovalForAll, [OPERATOR, true]),
    call(NFT, safeTransfer, [SPENDER, RECEIVER, 7n]),
  ]);
  const decoded = decodeFunctionData({ abi: [erc721Approve], data: next[0]?.data ?? "0x" });
  assert.equal(getAddress(decoded.args[0]), OPERATOR);
  assert.equal(decoded.args[1], 7n);
});

test("a collection grant becomes the only held token", () => {
  const next = narrowSiteApprovals([call(NFT, setApprovalForAll, [OPERATOR, true])], [
    { contract: NFT, tokenId: 9n, standard: "erc721" },
  ]);
  const decoded = decodeFunctionData({ abi: [erc721Approve], data: next[0]?.data ?? "0x" });
  assert.equal(decoded.args[1], 9n);
});

test("a collection grant is refused when more than one token is held", () => {
  assert.throws(
    () =>
      narrowSiteApprovals([call(NFT, setApprovalForAll, [OPERATOR, true])], [
        { contract: NFT, tokenId: 1n, standard: "erc721" },
        { contract: NFT, tokenId: 2n, standard: "erc721" },
      ]),
    new RegExp(COLLECTION_APPROVAL_REFUSED),
  );
});

test("clearing a collection operator is left in place", () => {
  const calls = [call(NFT, setApprovalForAll, [OPERATOR, false])];
  assert.equal(narrowSiteApprovals(calls)[0]?.data, calls[0]?.data);
});

test("an ERC-1155 collection grant is refused", () => {
  assert.throws(
    () =>
      narrowSiteApprovals([call(NFT, setApprovalForAll, [OPERATOR, true])], [
        { contract: NFT, tokenId: 3n, standard: "erc1155" },
      ]),
    new RegExp(COLLECTION_APPROVAL_REFUSED),
  );
});

test("the permission advisory is stated once", () => {
  assert.match(withPermissionAdvisory("Sent."), new RegExp(PERMISSION_ADVISORY));
  assert.equal(withPermissionAdvisory(PERMISSION_ADVISORY), PERMISSION_ADVISORY);
});
