import assert from "node:assert/strict";
import test from "node:test";
import { isWalletConnectLink, pairingCodeFromLink } from "./pairingLink";

const full = "wc:94caa59c77dae0dd234b5818fb7292540d017b27d41f7f387ee75b22b9738c94@2?relay-protocol=irn&symKey=ce3a2c77";
const stub = "wc:00e46b69-d0cc-4b3e-b6a2-cee442f97188@2";

test("a deep link keeps the symKey that sits after an ampersand", () => {
  assert.equal(pairingCodeFromLink(`knoad://wc?uri=${full}`), full);
});

test("an encoded deep link decodes to the same code", () => {
  assert.equal(pairingCodeFromLink(`knoad://wc?uri=${encodeURIComponent(full)}`), full);
});

test("a signature stub does not start a new pairing", () => {
  assert.equal(pairingCodeFromLink(`knoad://wc?uri=${stub}`), null);
  assert.equal(isWalletConnectLink(`knoad://wc?uri=${stub}`), true);
});

test("a plain page address is left alone", () => {
  assert.equal(pairingCodeFromLink("https://app.uniswap.org/"), null);
  assert.equal(isWalletConnectLink("https://app.uniswap.org/"), false);
});
