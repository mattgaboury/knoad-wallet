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

/**
 * Pairs a WalletConnect URI. The dApp receives the account address and
 * whatever the user confirms. It does not receive the seed or a hot key.
 */
export async function pairWalletConnect(args: {
  projectId: string;
  uri: string;
  account: Address;
  chainId: number;
  approveSite(peer: { name: string; url: string }): Promise<boolean>;
  confirm(decision: SessionDecision): Promise<boolean>;
  signMessage(message: string, chainId: number): Promise<Hex>;
  signTypedData(typedDataJson: string, chainId: number): Promise<Hex>;
  sendCalls(calls: Call[], chainId: number): Promise<Hex>;
  switchChain(chainId: number): Promise<void>;
}): Promise<WalletConnectSession> {
  if (!args.projectId.trim()) {
    throw new Error("Paste a WalletConnect project id from cloud.reown.com.");
  }
  const client = await SignClient.init({
    projectId: args.projectId.trim(),
    metadata: {
      name: "KNOAD Wallet",
      description: "Phone wallet",
      url: "https://knoad.io",
      icons: ["https://knoad.io/favicon.ico"],
    },
  });

  let topic = "";
  let peer = { name: "Site", url: "", icon: undefined as string | undefined };
  const facing = dappFacingState(args.account, args.chainId);
  const chains = CHAINS.map((chain) => `eip155:${chain.chainId}`);
  const accounts = CHAINS.map((chain) => `eip155:${chain.chainId}:${facing.address}`);
  const approved = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The site did not finish connecting.")), 30_000);
    client.on("session_proposal", async (proposal) => {
      try {
        const metadata = (proposal.params as { proposer?: { metadata?: { name?: string; url?: string; icons?: string[] } } }).proposer?.metadata;
        if (metadata?.name) peer = { name: metadata.name, url: metadata.url ?? "", icon: metadata.icons?.[0] };
        clearTimeout(timer);
        const accepted = await args.approveSite({ name: peer.name, url: peer.url });
        if (!accepted) {
          await client.reject({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
          reject(new Error("Not connected."));
          return;
        }
        const namespaces = buildApprovedNamespaces({
          proposal: proposal.params as Parameters<typeof buildApprovedNamespaces>[0]["proposal"],
          supportedNamespaces: {
            eip155: {
              chains,
              methods: METHODS,
              events: ["accountsChanged", "chainChanged"],
              accounts,
            },
          },
        });
        const session = await client.approve({ id: proposal.id, namespaces });
        if (session.topic) topic = session.topic;
        clearTimeout(timer);
        resolve();
      } catch (error) {
        clearTimeout(timer);
        try {
          await client.reject({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
        } catch {
          // The proposal is already closed.
        }
        reject(error instanceof Error ? error : new Error("Could not connect."));
      }
    });
  });

  client.on("session_request", async (event) => {
    topic = event.topic;
    const chainId = chainFromEvent(event, args.chainId);
    const decision = routeSessionRequest({
      method: event.params.request.method,
      params: event.params.request.params,
      account: args.account,
      chainId,
    });
    const fail = (message: string) =>
      client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", error: { code: 4001, message } },
      });

    if (decision.kind === "reject") {
      await fail(decision.reason);
      return;
    }
    const accepted = await args.confirm(decision);
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
      await args.switchChain(decision.chainId);
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: null },
      });
      return;
    }
    if (decision.kind === "sign-message") {
      const signature = await args.signMessage(decision.message, decision.chainId);
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: signature },
      });
      return;
    }
    if (decision.kind === "sign-typed-data") {
      const signature = await args.signTypedData(decision.typedDataJson, decision.chainId);
      await client.respond({
        topic: event.topic,
        response: { id: event.id, jsonrpc: "2.0", result: signature },
      });
      return;
    }
    const hash = await args.sendCalls(decision.calls, decision.chainId);
    await client.respond({
      topic: event.topic,
      response: { id: event.id, jsonrpc: "2.0", result: hash },
    });
  });

  const connected = approved.catch((error: unknown) => error);
  try {
    await client.pair({ uri: args.uri.trim() });
  } catch (error) {
    void connected;
    throw error;
  }
  const result = await connected;
  if (result instanceof Error) throw result;

  return {
    topic,
    name: peer.name,
    url: peer.url,
    icon: peer.icon,
    async disconnect() {
      if (!topic) return;
      await client.disconnect({ topic, reason: { code: 6000, message: "Disconnected" } });
    },
  };
}

function chainFromEvent(event: SessionRequestEvent, fallback: number): number {
  const raw = event.params.chainId;
  if (!raw?.includes(":")) return fallback;
  const chainId = Number(raw.split(":")[1]);
  return getChain(chainId) ? chainId : fallback;
}
