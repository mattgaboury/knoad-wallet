import assert from "node:assert/strict";
import test from "node:test";
import { LEGAL_DOCUMENTS, LEGAL_STORAGE_KEY, LEGAL_VERSION, reachedEnd } from "./legal";

test("acceptance is stored under the wallet legal key for this version", () => {
  assert.equal(LEGAL_STORAGE_KEY, "knoad.legal.v");
  assert.equal(LEGAL_VERSION, "2026-10-20");
});

test("accept stays off until the scroll reaches the end", () => {
  assert.equal(reachedEnd(0, 0, 400), false);
  assert.equal(reachedEnd(200, 0, 800), false);
  assert.equal(reachedEnd(200, 560, 800), false);
  assert.equal(reachedEnd(200, 576, 800), true);
});

test("the phone shows the terms and privacy, not a separate addendum", () => {
  const text = JSON.stringify(LEGAL_DOCUMENTS);
  assert.equal(text.toLowerCase().includes("addendum"), false);
  assert.equal(LEGAL_DOCUMENTS[0]?.title, "Terms of Service");
  assert.equal(LEGAL_DOCUMENTS[1]?.title, "Privacy Policy");
  assert.match(text, /non-custodial/);
  assert.match(text, /does not receive the 24-word recovery phrase/i);
});

test("accept is on when the text fits without scrolling", () => {
  assert.equal(reachedEnd(800, 0, 800), true);
  assert.equal(reachedEnd(800, 0, 640), true);
});
