import assert from "node:assert/strict";
import test from "node:test";
import { assertRehearsalChain } from "./guard.ts";

test("rehearsal refuses Ethereum and Base", () => {
  assert.throws(() => assertRehearsalChain(1), /Refusing chain 1/);
  assert.throws(() => assertRehearsalChain(8453), /Refusing chain 8453/);
  assert.throws(() => assertRehearsalChain(56), /Refusing chain 56/);
  assert.doesNotThrow(() => assertRehearsalChain(84532));
  assert.doesNotThrow(() => assertRehearsalChain(11155111));
});
