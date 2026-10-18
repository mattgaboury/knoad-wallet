import SignClient from "@walletconnect/sign-client";
import {
  RELAY_CHAINS,
  RELAY_METHODS,
  accountFromNamespace,
  chainHex,
  routeExtensionRequest,
  sanitizeRelay,
  emptyRelay,
  type RelayRecord,
} from "./protocol";

const SESSION_KEY = "knoad.relay";
const originWaiters = new Map<string, (accepted: boolean) => void>();
let phoneWaiting = false;
let clientPromise: Promise<WcClient> | null = null;

type WcSession = { topic: string; namespaces: { eip155?: { accounts?: string[] } } };
type WcClient = {
  connect(args: unknown): Promise<{ uri?: string; approval: () => Promise<WcSession> }>;
  request(args: { topic: string; chainId: string; request: { method: string; params?: unknown } }): Promise<unknown>;
  disconnect(args: { topic: string; reason: { code: number; message: string } }): Promise<void>;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : "Request failed." });
    });
  return true;
});

async function handle(message: unknown): Promise<unknown> {
  const body = (message ?? {}) as { type?: string; origin?: string; method?: string; params?: unknown; projectId?: string; accepted?: boolean };
  if (body.type === "get-state") return state();
  if (body.type === "set-project") {
    const record = await read();
    clientPromise = null;
    await write({ ...record, projectId: body.projectId ?? "" });
    return state();
  }
  if (body.type === "start-pair") return { uri: await startPair((await read()).projectId) };
  if (body.type === "disconnect") {
    await disconnect();
    return state();
  }
  if (body.type === "decide-origin") {
    originWaiters.get(body.origin ?? "")?.(Boolean(body.accepted));
    originWaiters.delete(body.origin ?? "");
    if (originWaiters.size === 0) await chrome.action.setBadgeText({ text: "" });
    return state();
  }
  if (body.type === "provider-request") {
    return providerRequest(body.origin ?? "unknown", body.method ?? "", body.params);
  }
  return { error: "Unknown extension message." };
}

async function state() {
  return { record: await read(), pendingOrigins: [...originWaiters.keys()], phoneWaiting };
}

async function providerRequest(origin: string, method: string, params: unknown) {
  const route = routeExtensionRequest(method);
  if (route === "reject") return { error: "This request is not available." };
  let record = await read();
  if (!record.account || !record.topic) return { error: "Connect your phone first." };
  if (route === "chain") return { result: chainHex(record.chainId) };
  if (route === "accounts" && method === "eth_accounts") {
    return { result: record.approvedOrigins.includes(origin) ? [record.account] : [] };
  }
  if (!record.approvedOrigins.includes(origin)) record = await ensureOrigin(origin, record);
  if (route === "accounts") return { result: [record.account] };

  phoneWaiting = true;
  try {
    const client = await getClient(record.projectId);
    const result = await client.request({
      topic: record.topic as string,
      chainId: `eip155:${record.chainId}`,
      request: { method, params },
    });
    if (method === "wallet_switchEthereumChain") {
      const requested = chainIdFromParams(params);
      if (requested) {
        record = sanitizeRelay({ ...record, chainId: requested });
        await write(record);
        await broadcast({ type: "chain-changed", chainId: chainHex(requested) });
      }
    }
    return { result };
  } finally {
    phoneWaiting = false;
  }
}

async function ensureOrigin(origin: string, record: RelayRecord): Promise<RelayRecord> {
  const accepted = await new Promise<boolean>((resolve) => {
    originWaiters.set(origin, resolve);
    void chrome.action.setBadgeText({ text: "1" });
    void chrome.action.setBadgeBackgroundColor({ color: "#3dd68c" });
  });
  if (!accepted) throw new Error("This site was rejected.");
  const fresh = await read();
  const next = sanitizeRelay({
    ...fresh,
    approvedOrigins: [...new Set([...fresh.approvedOrigins, origin])],
  });
  await write(next);
  if (originWaiters.size === 0) await chrome.action.setBadgeText({ text: "" });
  return next;
}

async function startPair(projectId: string): Promise<string> {
  if (!projectId) throw new Error("Add a connection id first.");
  const client = await getClient(projectId);
  const started = await client.connect({
    optionalNamespaces: {
      eip155: {
        chains: RELAY_CHAINS.map((id) => `eip155:${id}`),
        methods: RELAY_METHODS,
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });
  if (!started.uri) throw new Error("WalletConnect did not return a pairing code.");
  void started.approval().then(async (session) => {
    const current = await read();
    await write({
      ...current,
      account: accountFromNamespace(session.namespaces.eip155?.accounts),
      topic: session.topic,
      projectId,
    });
    const account = accountFromNamespace(session.namespaces.eip155?.accounts);
    await broadcast({ type: "accounts-changed", accounts: account ? [account] : [] });
  });
  return started.uri;
}

async function disconnect() {
  const record = await read();
  if (record.topic && record.projectId) {
    try {
      const client = await getClient(record.projectId);
      await client.disconnect({ topic: record.topic, reason: { code: 6000, message: "Disconnected" } });
    } catch {
      // The phone may already have closed the session.
    }
  }
  clientPromise = null;
  await write({ ...emptyRelay(), projectId: record.projectId });
  await broadcast({ type: "accounts-changed", accounts: [] });
}

function getClient(projectId: string): Promise<WcClient> {
  if (!projectId) return Promise.reject(new Error("Add a connection id first."));
  if (!clientPromise) {
    clientPromise = SignClient.init({
      projectId,
      storage: wcStorage(),
      metadata: {
        name: "KNOAD Wallet",
        description: "Approvals stay on your phone",
        url: "https://knoad.io",
        icons: [chrome.runtime.getURL("icons/icon128.png")],
      },
    }) as Promise<WcClient>;
  }
  return clientPromise;
}

function wcStorage() {
  const prefix = "wc:";
  return {
    async getKeys() {
      const all = await chrome.storage.local.get(null);
      return Object.keys(all)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
    async getEntries<T = unknown>(): Promise<[string, T][]> {
      const keys = await this.getKeys();
      const entries: [string, T][] = [];
      for (const key of keys) {
        const value = await this.getItem<T>(key);
        if (value !== undefined) entries.push([key, value]);
      }
      return entries;
    },
    async getItem<T = unknown>(key: string): Promise<T | undefined> {
      const stored = await chrome.storage.local.get(prefix + key);
      return stored[prefix + key] as T | undefined;
    },
    async setItem(key: string, value: unknown) {
      await chrome.storage.local.set({ [prefix + key]: value });
    },
    async removeItem(key: string) {
      await chrome.storage.local.remove(prefix + key);
    },
  };
}

async function read(): Promise<RelayRecord> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return sanitizeRelay(stored[SESSION_KEY]);
}

async function write(record: RelayRecord) {
  await chrome.storage.local.set({ [SESSION_KEY]: sanitizeRelay(record) });
}

async function broadcast(message: unknown) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, message).catch(() => undefined))));
}

function chainIdFromParams(params: unknown): number | null {
  const body = Array.isArray(params) ? params[0] : params;
  if (!body || typeof body !== "object") return null;
  const chainId = (body as { chainId?: unknown }).chainId;
  if (typeof chainId !== "string") return null;
  const value = chainId.startsWith("0x") ? Number.parseInt(chainId, 16) : Number(chainId);
  return Number.isInteger(value) ? value : null;
}
