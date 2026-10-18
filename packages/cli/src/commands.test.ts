import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recoverAddress, zeroAddress } from "viem";
import { buildRecovery, derivationVectors, writeDerivationVectors } from "./commands";

test("published derivation vectors contain addresses, not keys", () => {
  const vectors = derivationVectors();
  const path = writeDerivationVectors();
  const written = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(written.accounts[0].recoveryEpoch0, vectors.accounts[0].recoveryEpoch0);
  assert.equal(JSON.stringify(written).includes("privateKey"), false);
  assert.notEqual(vectors.accounts[0].recoveryEpoch0, vectors.accounts[0].initialHotChain1);
  assert.notEqual(vectors.accounts[0].initialHotChain1, vectors.accounts[0].initialHotChain8453);
  assert.equal(vectors.accounts[0].paths.recoveryEpoch0, "m/7331'/60'/0'/0'/0'");
});

test("recover builds a signature from the current epoch and names the next one", async () => {
  const vectors = derivationVectors();
  const built = await buildRecovery({
    mnemonic: vectors.mnemonic,
    accountIndex: 0,
    account: "0x00000000000000000000000000000000000000aa",
    chainId: 8453n,
    newHotSigner: vectors.accounts[0].initialHotChain1,
    newHotKeyType: 2,
    recoveryEpoch: 0n,
    authorityNonce: 0n,
    deadline: 1_900_000_000n,
  });
  assert.equal(built.recoveryAuthority, vectors.accounts[0].recoveryEpoch0);
  assert.equal(built.nextRecoveryAuthority, vectors.accounts[0].recoveryEpoch1);
  assert.equal(await recoverAddress({ hash: built.digest, signature: built.signature }), vectors.accounts[0].recoveryEpoch0);
  assert.notEqual(built.nextRecoveryAuthority, zeroAddress);
});
