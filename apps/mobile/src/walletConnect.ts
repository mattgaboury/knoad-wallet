import SignClient from "@walletconnect/sign-client";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import {
  CHAINS,
  dappFacingState,
  getChain,
  routeSessionRequest,
  type Address,
  type Call,
  type Hex,
  type SessionDecision,
} from "@knoad/wallet-core";

type Client = Awaited<ReturnType<typeof SignClient.init>>;

type SessionRequestEvent = {
  id: number;
  topic: string;
  params: { chainId?: string; request: { method: string; params?: unknown } };
};

export type WalletConnectSession = {
  topic: string;
  name: string;
  url: string;
  icon?: string;
  disconnect(): Promise<void>;
};

export type WalletConnectHandlers = {
  account: Address;
  chainId: number;
  note(message: string): void;
  approveSite(peer: { name: string; url: string }): Promise<boolean>;
  confirm(decision: SessionDecision): Promise<boolean>;
  signMessage(message: string, chainId: number): Promise<Hex>;
  signTypedData(typedDataJson: string, chainId: number): Promise<Hex>;
  sendCalls(calls: Call[], chainId: number): Promise<Hex>;
  switchChain(chainId: number): Promise<void>;
};

const METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_sendCalls",
];

const METADATA = {
  name: "KNOAD Wallet",
  description: "Phone wallet",
  url: "https://knoad.io",
  icons: ["https://knoad.io/favicon.ico"],
};

let handlers: WalletConnectHandlers | null = null;
let clientPromise: Promise<Client> | null = null;
let clientProjectId = "";
let pairing: {
  resolve: (session: WalletConnectSession) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/** The listener reads this at request time, so a later chain or key is the one that signs. */
export function bindWalletConnect(next: WalletConnectHandlers | null) {
  handlers = next;
}

function getClient(projectId: string): Promise<Client> {
  const id = projectId.trim();
  if (!id) return Promise.reject(new Error("Paste a WalletConnect project id from cloud.reown.com."));
  if (clientPromise && clientProjectId === id) return clientPromise;
  clientProjectId = id;
  const pending = SignClient.init({ projectId: id, metadata: METADATA }).then((client) => {
    listen(client);
    return client;
  });
  clientPromise = pending;
  pending.catch(() => {
    if (clientPromise === pending) {
      clientPromise = null;
      clientProjectId = "";
    }
  });
  return pending;
}

function listen(client: Client) {
  client.on("session_proposal", (proposal) => {
    void onProposal(client, proposal);
  });
  client.on("session_request", (event) => {
    void onSessionRequest(client, event as SessionRequestEvent);
  });
}

async function onProposal(client: Client, proposal: { id: number; params: unknown }) {
  const waiting = pairing;
  if (!waiting) {
    try {
      await client.reject({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
    } catch {
      // The proposal is already closed.
    }
    return;
  }
  const current = handlers;
  try {
    if (!current) throw new Error("Unlock this phone first.");
    const metadata = (proposal.params as { proposer?: { metadata?: { name?: string; url?: string; icons?: string[] } } }).proposer?.metadata;
    const peer = {
      name: metadata?.name || "Site",
      url: metadata?.url ?? "",
      icon: metadata?.icons?.[0],
    };
    clearTimeout(waiting.timer);
    const accepted = await current.approveSite({ name: peer.name, url: peer.url });
    if (!accepted) {
      await client.reject({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
      pairing = null;
      waiting.reject(new Error("Not connected."));
      return;
    }
    const facing = dappFacingState(current.account, current.chainId);
    const namespaces = buildApprovedNamespaces({
      proposal: proposal.params as Parameters<typeof buildApprovedNamespaces>[0]["proposal"],
      supportedNamespaces: {
        eip155: {
          chains: CHAINS.map((chain) => `eip155:${chain.chainId}`),
          methods: METHODS,
          events: ["accountsChanged", "chainChanged"],
          accounts: CHAINS.map((chain) => `eip155:${chain.chainId}:${facing.address}`),
        },
      },
    });
    const session = await client.approve({ id: proposal.id, namespaces });
    pairing = null;
    waiting.resolve({
      topic: session.topic,
      name: peer.name,
      url: peer.url,
      icon: peer.icon,
      async disconnect() {
        if (!session.topic) return;
        await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "Disconnected" } });
      },
    });
  } catch (error) {
    clearTimeout(waiting.timer);
    pairing = null;
    try {
      await client.reject({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
    } catch {
      // The proposal is already closed.
    }
    waiting.reject(error instanceof Error ? error : new Error("Could not connect."));
  }
}

async function onSessionRequest(client: Client, event: SessionRequestEvent) {
  const fail = async (message: string) => {
    try {
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", error: { code: 4001, message } },
      });
    } catch {
      // The site already moved on.
    }
  };
  const current = handlers;
  if (!current) {
    await fail("Unlock this phone first.");
    return;
  }
  try {
    const chainId = chainFromEvent(event, current.chainId);
    const decision = routeSessionRequest({
      method: event.params.request.method,
      params: event.params.request.params,
      account: current.account,
      chainId,
    });
    if (decision.kind === "reject") {
      current.note(decision.reason);
      await fail(decision.reason);
      return;
    }
    const accepted = await current.confirm(decision);
    if (!accepted) {
      await fail("Rejected");
      return;
    }
    if (decision.kind === "accounts") {
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: [decision.address] },
      });
      return;
    }
    if (decision.kind === "chain") {
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: `0x${decision.chainId.toString(16)}` },
      });
      return;
    }
    if (decision.kind === "switch-chain") {
      await current.switchChain(decision.chainId);
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: null },
      });
      return;
    }
    if (decision.kind === "sign-message") {
      const signature = await current.signMessage(decision.message, decision.chainId);
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: signature },
      });
      return;
    }
    if (decision.kind === "sign-typed-data") {
      const signature = await current.signTypedData(decision.typedDataJson, decision.chainId);
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: signature },
      });
      return;
    }
    const hash = await current.sendCalls(decision.calls, decision.chainId);
    await client.respond({
      topic: event.topic,
      response: { id: event.id, jsonrpc: "2.0", result: hash },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not approve.";
    current.note(message);
    await fail(message);
  }
}

/**
 * Pairs a WalletConnect URI. The dApp receives the account address and
 * whatever the user confirms. It does not receive the seed or a hot key.
 */
export async function pairWalletConnect(args: { projectId: string; uri: string } & WalletConnectHandlers): Promise<WalletConnectSession> {
  bindWalletConnect(args);
  const client = await getClient(args.projectId);
  if (pairing) throw new Error("Already connecting.");
  return new Promise<WalletConnectSession>((resolve, reject) => {
    const timer = setTimeout(() => {
      pairing = null;
      reject(new Error("The site did not finish connecting."));
    }, 30_000);
    pairing = { resolve, reject, timer };
    void client.pair({ uri: args.uri.trim() }).catch((error: unknown) => {
      if (pairing?.reject !== reject) return;
      clearTimeout(timer);
      pairing = null;
      reject(error instanceof Error ? error : new Error("Could not connect."));
    });
  });
}

function chainFromEvent(event: SessionRequestEvent, fallback: number): number {
  const raw = event.params.chainId;
  if (!raw?.includes(":")) return fallback;
  const chainId = Number(raw.split(":")[1]);
  return getChain(chainId) ? chainId : fallback;
}
