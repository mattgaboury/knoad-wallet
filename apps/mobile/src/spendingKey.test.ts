import assert from "node:assert/strict";
import test from "node:test";
import { spendingKeyLine } from "./spendingKey";

const SIGNER = "0x5a4Bf13b651A66E583d9e7d7F948Cbca697C18B2";

test("an unused chain names the first spending key", () => {
  assert.equal(
    spendingKeyLine({ deployed: false, pending: false, generation: "0", signer: null, since: null }),
    "First spending key. It changes on the first send.",
  );
});

test("a waiting send names the next spending key", () => {
  assert.equal(
    spendingKeyLine({ deployed: true, pending: true, generation: "1", signer: SIGNER, since: Date.UTC(2026, 9, 18, 12) }),
    "A new spending key is waiting for this send.",
  );
});

test("a changed key shows its number, public address, and date", () => {
  const line = spendingKeyLine({
    deployed: true,
    pending: false,
    generation: "1",
    signer: SIGNER,
    since: Date.UTC(2026, 9, 18, 12),
  });
  assert.equal(line, "Spending key 1 · 0x5a4B...C18B2 · Oct 18, 2026");
});

test("a changed key without a block time omits the date", () => {
  assert.equal(
    spendingKeyLine({ deployed: true, pending: false, generation: "5", signer: SIGNER, since: null }),
    "Spending key 5 · 0x5a4B...C18B2",
  );
});
