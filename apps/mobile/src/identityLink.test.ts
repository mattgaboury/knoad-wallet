import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityClient } from "./identity/client";
import { DISCORD_RETURN_URL, initialSelection, linkSelection, LINK_COPY, staysUnlinked } from "./identity/copy";
import { identityCodeFromLink } from "./identity/link";

test("a Discord return is not a WalletConnect code", () => {
  assert.deepEqual(identityCodeFromLink("knoad://wc?uri=wc:abc@2?symKey=ffff"), null);
  assert.deepEqual(identityCodeFromLink("wc:abc@2?symKey=ffff"), null);
  assert.deepEqual(identityCodeFromLink("https://knoad.io/wallet/discord?code=one&state=two"), { code: "one", state: "two" });
  assert.deepEqual(identityCodeFromLink("knoad://discord?code=one&state=two"), { code: "one", state: "two" });
  assert.deepEqual(identityCodeFromLink("exp://192.168.0.136:8081/--/discord?code=one&state=two"), {
    code: "one",
    state: "two",
  });
  assert.equal(identityCodeFromLink("https://evil.example/wallet/discord?code=one&state=two"), null);
});

test("only the active wallet starts selected, and a full profile stops the rest", () => {
  assert.deepEqual(initialSelection(["main", "other"], "main"), ["main"]);
  assert.deepEqual(initialSelection(["main", "other"], "missing"), []);
  const open = linkSelection({
    selectedIds: ["main"],
    wallets: [
      { id: "main", address: "0xabc" },
      { id: "other", address: "0xdef" },
    ],
    linked: [],
    remaining: 4,
  });
  assert.equal(open.canConfirm, true);
  const full = linkSelection({
    selectedIds: ["main", "other"],
    wallets: [
      { id: "main", address: "0xabc" },
      { id: "other", address: "0xdef" },
    ],
    linked: ["0xabc"],
    remaining: 0,
  });
  assert.equal(full.canConfirm, false);
  assert.equal(full.reason, LINK_COPY.full);
});

test("the phone sends signatures and the one-time code, never a key or Discord token", async () => {
  const calls: { url: string; body?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? String(init.body) : undefined });
    const url = String(input);
    if (url.endsWith("/status")) return json({ enabled: true });
    if (url.endsWith("/start")) return json({ authorizeUrl: "https://discord.com/oauth2/authorize?scope=identify", state: "state" });
    if (url.endsWith("/exchange")) return json({ token: "link-token", expiresAt: "2026-05-20T18:30:00.000Z", profile: { id: "1", displayName: "Crono", avatarUrl: "https://cdn.example/a.png" } });
    if (url.endsWith("/confirm")) return json({ linked: [] });
    return json({});
  };
  const client = createIdentityClient("https://knoad.io", fetchImpl);
  assert.equal((await client.status()).enabled, true);
  const started = await client.start(DISCORD_RETURN_URL);
  assert.match(started.authorizeUrl, /scope=identify/);
  await client.exchange("one-time", "state");
  await client.confirm("link-token", [{ address: "0xabc", signature: "0xsig" }]);
  const sent = JSON.stringify(calls);
  assert.equal(sent.includes("privateKey"), false);
  assert.equal(sent.includes("seed"), false);
  assert.equal(sent.includes("discord-access"), false);
  assert.match(calls.find((call) => call.url.endsWith("/confirm"))?.body ?? "", /"signature":"0xsig"/);
  assert.equal(staysUnlinked("This account is not deployed on that chain yet."), true);
  assert.equal(staysUnlinked("This signature checks Base. This account is not on Base yet."), true);
  assert.match(LINK_COPY.safetyBody, /Your wallet stays yours/);
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
