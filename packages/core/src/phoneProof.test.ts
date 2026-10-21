import assert from "node:assert/strict";
import test from "node:test";
import { hashMessage, recoverAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { personalSignDigest } from "./account";
import { deployments } from "./deployments";
import { ERC6492_MAGIC, wrapErc6492Signature } from "./erc6492";
import { messageChainId } from "./session";

const HOT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;

test("signPersonal output recovers the spending key of the ERC-7739 digest", async () => {
  const hot = privateKeyToAccount(HOT_KEY);
  const message = "knoad.io wants you to link this wallet to your Discord account.\nChain ID: 8453";
  const digest = personalSignDigest(ACCOUNT, 8453n, message);
  const signature = await hot.sign({ hash: digest });
  assert.equal(await recoverAddress({ hash: digest, signature }), hot.address);
  assert.notEqual((await recoverAddress({ hash: hashMessage(message), signature })).toLowerCase(), ACCOUNT.toLowerCase());
  assert.equal(messageChainId(message), 8453);
});

test("an undeployed phone signature wraps that proof for the real factory", async () => {
  const hot = privateKeyToAccount(HOT_KEY);
  const message = "link";
  const signature = await hot.sign({ hash: personalSignDigest(ACCOUNT, 8453n, message) });
  assert.equal(deployments.factory, "0x640b63604581cC0b1326025a57C188BCc6160Dc9");
  const wrapped = wrapErc6492Signature({
    factory: deployments.factory,
    factoryCalldata: "0x1234",
    signature,
  });
  assert.equal(wrapped.toLowerCase().endsWith(ERC6492_MAGIC.slice(2)), true);
  assert.equal(wrapped.toLowerCase().includes(signature.slice(2).toLowerCase()), true);
});
