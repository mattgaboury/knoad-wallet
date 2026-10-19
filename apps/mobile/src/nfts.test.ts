import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { activityFromNftTransfers, heldFromBlockscout, nftTransferCall, siteCallLabel } from "./nfts";

const ACCOUNT = getAddress("0xeDeD690e3DEfF09AE71192534BD5479c5b03F0Db");
const CONTRACT = getAddress("0x71772beff1fb348eb7d5f9f1e0b5f11bc49ab5e4");

test("a blockscout token becomes one held NFT", () => {
  const held = heldFromBlockscout(1, {
    items: [
      {
        id: "4133",
        image_url: "https://example.com/4133.png",
        value: "1",
        token: { address_hash: CONTRACT, name: "Appreciators", type: "ERC-721" },
        metadata: { name: "Appreciators #4133", image: "ipfs://cid/4133.png" },
      },
    ],
  });
  assert.equal(held.length, 1);
  assert.equal(held[0].contract, CONTRACT);
  assert.equal(held[0].tokenId, "4133");
  assert.equal(held[0].collection, "Appreciators");
  assert.equal(held[0].name, "Appreciators #4133");
  assert.equal(held[0].image, "https://example.com/4133.png");
  assert.equal(held[0].standard, "erc721");
});

test("an incoming transfer is activity for that NFT", () => {
  const rows = activityFromNftTransfers(1, ACCOUNT, {
    items: [
      {
        transaction_hash: "0xabc",
        log_index: 10,
        timestamp: "2026-10-18T16:46:28.000Z",
        token: { name: "Appreciators" },
        total: { token_id: "4133" },
        from: { hash: "0x7CAE81d859ad41Ef5AD8110364E1D656477f7345" },
        to: { hash: ACCOUNT },
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "nft");
  assert.equal(rows[0].asset, "Appreciators");
  assert.equal(rows[0].amount, "#4133");
  assert.equal(rows[0].txHash, "0xabc");
  assert.equal(rows[0].toName, undefined);
});

test("an NFT transfer uses safeTransferFrom", () => {
  const data = nftTransferCall({
    from: ACCOUNT,
    to: getAddress("0x00000000000000000000000000000000000000bb"),
    tokenId: "4133",
    standard: "erc721",
  });
  assert.equal(data.slice(0, 10), "0x42842e0e");
  assert.equal(siteCallLabel([{ data }]), "NFT transfer");
  assert.equal(siteCallLabel([{ data: "0x12345678" }]), "Site transaction");
});
