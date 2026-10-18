import assert from "node:assert/strict";
import test from "node:test";
import {
  accountFromNamespace,
  assertRelayHasNoKey,
  emptyRelay,
  routeExtensionRequest,
  sanitizeRelay,
} from "./protocol";

test("relay storage keeps the pairing and never a wallet key", () => {
  const record = sanitizeRelay({
    account: "0x00000000000000000000000000000000000000aa",
    chainId: 84532,
    approvedOrigins: ["https://app.example"],
    projectId: "public-project",
    topic: "pairing-topic",
    privateKey: "0xsecret",
    mnemonic: "abandon abandon",
  });
  assert.equal(record.account, "0x00000000000000000000000000000000000000aa");
  assert.equal(record.topic, "pairing-topic");
  assert.deepEqual(record.approvedOrigins, ["https://app.example"]);
  assert.equal("privateKey" in record, false);
  assertRelayHasNoKey(record);
  assert.equal(JSON.stringify(record).includes("secret"), false);
  assert.equal(JSON.stringify(emptyRelay()).includes("mnemonic"), false);
  assert.throws(() => assertRelayHasNoKey({ ...emptyRelay(), projectId: "privateKey=0xabc" }));
});

test("signing goes to the phone and key export does not", () => {
  assert.equal(routeExtensionRequest("eth_requestAccounts"), "accounts");
  assert.equal(routeExtensionRequest("eth_chainId"), "chain");
  assert.equal(routeExtensionRequest("personal_sign"), "phone");
  assert.equal(routeExtensionRequest("eth_signTypedData_v4"), "phone");
  assert.equal(routeExtensionRequest("wallet_switchEthereumChain"), "phone");
  assert.equal(routeExtensionRequest("eth_sign"), "reject");
  assert.equal(routeExtensionRequest("knoad_exportMnemonic"), "reject");
  assert.equal(accountFromNamespace(["eip155:84532:0x00000000000000000000000000000000000000aa"]), "0x00000000000000000000000000000000000000aa");
});
