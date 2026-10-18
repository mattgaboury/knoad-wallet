import assert from "node:assert/strict";
import test from "node:test";
import { secureStoreKey, secureStoreKv } from "./deviceKeys";

test("a hot-key id and a write-ahead id fit SecureStore", () => {
  const hot = "p256:0xabc123";
  const ahead = "wal:84532:0xabc123";
  for (const key of [hot, ahead, secureStoreKey(hot), secureStoreKey(ahead)]) {
    assert.match(secureStoreKey(key), /^[A-Za-z0-9._-]+$/);
  }
  assert.equal(secureStoreKey(hot), "p256_0xabc123");
  assert.notEqual(secureStoreKey(hot), secureStoreKey(ahead));
});

test("the store reads back the same logical key", async () => {
  const saved = new Map<string, string>();
  const kv = secureStoreKv({
    getItemAsync: async (key) => saved.get(key) ?? null,
    setItemAsync: async (key, value) => {
      saved.set(key, value);
    },
    deleteItemAsync: async (key) => {
      saved.delete(key);
    },
  });
  await kv.set("secp:0xabc", "secret");
  assert.equal(saved.has("secp:0xabc"), false);
  assert.equal(await kv.get("secp:0xabc"), "secret");
  await kv.delete("secp:0xabc");
  assert.equal(await kv.get("secp:0xabc"), null);
});
