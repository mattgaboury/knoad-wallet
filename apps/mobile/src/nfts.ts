import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import type { ActivityEntry } from "./activityLog";

export type NftStandard = "erc721" | "erc1155";

export type HeldNft = {
  chainId: number;
  contract: Address;
  tokenId: string;
  name: string;
  collection: string;
  image: string | null;
  standard: NftStandard;
  amount: string;
};

const HOSTS: Record<number, string> = {
  1: "https://eth.blockscout.com",
  8453: "https://base.blockscout.com",
};

const TRANSFER_SELECTORS = new Set(["0x23b872dd", "0x42842e0e", "0xb88d4fde", "0xf242432a"]);

export function siteCallLabel(calls: { data: string }[]): string {
  if (calls.length === 1 && TRANSFER_SELECTORS.has(calls[0].data.slice(0, 10).toLowerCase())) return "NFT transfer";
  return "Site transaction";
}

export function nftTransferCall(args: {
  from: Address;
  to: Address;
  tokenId: string;
  standard: NftStandard;
  amount?: string;
}): Hex {
  const tokenId = BigInt(args.tokenId);
  if (args.standard === "erc1155") {
    const amount = BigInt(args.amount && args.amount !== "0" ? args.amount : "1");
    return encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "safeTransferFrom",
          stateMutability: "nonpayable",
          inputs: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "id", type: "uint256" },
            { name: "amount", type: "uint256" },
            { name: "data", type: "bytes" },
          ],
          outputs: [],
        },
      ],
      functionName: "safeTransferFrom",
      args: [args.from, args.to, tokenId, amount, "0x"],
    });
  }
  return encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "safeTransferFrom",
        stateMutability: "nonpayable",
        inputs: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "tokenId", type: "uint256" },
        ],
        outputs: [],
      },
    ],
    functionName: "safeTransferFrom",
    args: [args.from, args.to, tokenId],
  });
}

export function heldFromBlockscout(chainId: number, body: unknown): HeldNft[] {
  const items = itemsOf(body);
  const held: HeldNft[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const token = record(row.token);
    const contract = addressOf(token.address_hash ?? token.address);
    const tokenId = text(row.id);
    if (!contract || !tokenId) continue;
    const standard: NftStandard = String(token.type ?? row.token_type ?? "").includes("1155") ? "erc1155" : "erc721";
    const collection = text(token.name) || "NFT";
    const meta = record(row.metadata);
    const name = text(meta.name) || `${collection} #${tokenId}`;
    const image = httpUrl(row.image_url) || httpUrl(meta.image);
    const amount = text(row.value) || "1";
    held.push({ chainId, contract, tokenId, name, collection, image, standard, amount });
  }
  return held;
}

export function activityFromNftTransfers(chainId: number, account: Address, body: unknown): ActivityEntry[] {
  const owner = getAddress(account).toLowerCase();
  const rows: ActivityEntry[] = [];
  for (const item of itemsOf(body)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const tx = text(row.transaction_hash);
    if (!tx) continue;
    const token = record(row.token);
    const total = record(row.total);
    const tokenId = text(total.token_id) || text(row.id);
    const collection = text(token.name) || "NFT";
    const from = addressOf(record(row.from).hash ?? row.from);
    const to = addressOf(record(row.to).hash ?? row.to);
    const incoming = to?.toLowerCase() === owner;
    const outgoing = from?.toLowerCase() === owner;
    if (!incoming && !outgoing) continue;
    const time = Date.parse(text(row.timestamp) ?? "");
    const logIndex = text(row.log_index) ?? "0";
    rows.push({
      id: `${tx}:${logIndex}`,
      chainId,
      kind: "nft",
      hash: tx,
      txHash: tx,
      amount: tokenId ? `#${tokenId}` : undefined,
      asset: collection,
      to: outgoing ? to ?? undefined : undefined,
      toName: outgoing && to ? short(to) : undefined,
      time: Number.isFinite(time) ? time : Date.now(),
      status: "included",
      reason: incoming ? "This NFT is in the account." : "Sent.",
      account: getAddress(account),
    });
  }
  return rows;
}

export async function readWalletNfts(account: Address): Promise<{ nfts: HeldNft[]; activity: ActivityEntry[]; ok: boolean }> {
  const chains = Object.keys(HOSTS).map(Number);
  const results = await Promise.all(
    chains.map(async (chainId) => {
      try {
        const host = HOSTS[chainId];
        const [nfts, activity, erc1155] = await Promise.all([
          readPages(chainId, `${host}/api/v2/addresses/${account}/nft`, heldFromBlockscout).catch(() => null),
          readPages(chainId, `${host}/api/v2/addresses/${account}/token-transfers?type=ERC-721`, (id, body) =>
            activityFromNftTransfers(id, account, body),
          ).catch(() => [] as ActivityEntry[]),
          readPages(chainId, `${host}/api/v2/addresses/${account}/token-transfers?type=ERC-1155`, (id, body) =>
            activityFromNftTransfers(id, account, body),
          ).catch(() => [] as ActivityEntry[]),
        ]);
        if (!nfts && activity.length === 0 && erc1155.length === 0) return { ok: false as const, nfts: [] as HeldNft[], activity: [] as ActivityEntry[] };
        return { ok: true as const, nfts: nfts ?? [], activity: [...activity, ...erc1155] };
      } catch {
        return { ok: false as const, nfts: [] as HeldNft[], activity: [] as ActivityEntry[] };
      }
    }),
  );
  return {
    ok: results.some((result) => result.ok),
    nfts: results.flatMap((result) => result.nfts),
    activity: results.flatMap((result) => result.activity),
  };
}

async function readPages<T>(chainId: number, firstUrl: string, map: (chainId: number, body: unknown) => T[]): Promise<T[]> {
  const found: T[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; page < 3 && url; page += 1) {
    const body = await getJson(url);
    found.push(...map(chainId, body));
    url = nextPage(firstUrl, body);
  }
  return found;
}

function nextPage(firstUrl: string, body: unknown): string | null {
  const params = record(body).next_page_params;
  if (!params || typeof params !== "object") return null;
  const [base, existing] = firstUrl.split("?");
  const search = new URLSearchParams(existing ?? "");
  let added = false;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value == null || typeof value === "object") continue;
    search.set(key, String(value));
    added = true;
  }
  if (!added) return null;
  return `${base}?${search.toString()}`;
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Could not read NFTs.");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function itemsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const items = record(body).items;
  return Array.isArray(items) ? items : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function addressOf(value: unknown): Address | null {
  const raw = text(value);
  if (!raw || !isAddress(raw)) return null;
  return getAddress(raw);
}

function httpUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (raw.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${raw.slice("ipfs://".length)}`;
  return raw.startsWith("https://") ? raw : null;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
