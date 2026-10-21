export type DiscordProfile = { id: string; displayName: string; avatarUrl: string };

export type LinkedAddress = {
  address: string;
  checksum: string;
  role: "primary" | "secondary";
  verifiedByApp: boolean;
};

export type WalletAppAccount = {
  connected: boolean;
  profile: DiscordProfile | null;
  addresses: LinkedAddress[];
  remaining: number;
};

export type LinkChallenge = { address: string; message: string; expiresAt: string };

export class IdentityRequestError extends Error {
  code?: string;
  addresses?: string[];

  constructor(message: string, code?: string, addresses?: string[]) {
    super(message);
    this.code = code;
    this.addresses = addresses;
  }
}

type Json = Record<string, unknown>;

export function createIdentityClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const root = baseUrl.replace(/\/$/, "");

  async function send(path: string, token?: string, body?: Json): Promise<Json> {
    const headers: Record<string, string> = {};
    if (body) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(`${root}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as Json & {
      error?: string;
      code?: string;
      addresses?: string[];
    };
    if (!response.ok) {
      throw new IdentityRequestError(payload.error || "Could not reach knoad.", payload.code, payload.addresses);
    }
    return payload;
  }

  return {
    status: async () => {
      const body = await send("/api/wallet-app/status");
      return { enabled: body.enabled === true };
    },
    start: async (returnUrl: string) => {
      const body = await send("/api/wallet-app/discord/start", undefined, { returnUrl });
      return { authorizeUrl: String(body.authorizeUrl ?? ""), state: String(body.state ?? "") };
    },
    exchange: async (code: string, state: string) => {
      const body = await send("/api/wallet-app/discord/exchange", undefined, { code, state });
      return {
        token: String(body.token ?? ""),
        expiresAt: String(body.expiresAt ?? ""),
        profile: body.profile as DiscordProfile,
      };
    },
    account: (token: string) => send("/api/wallet-app/wallets", token) as Promise<WalletAppAccount>,
    challenge: async (token: string, addresses: string[], chainId: number) => {
      const body = await send("/api/wallet-app/wallets/challenge", token, { addresses, chainId });
      return (body.challenges ?? []) as LinkChallenge[];
    },
    confirm: (token: string, proofs: { address: string; signature: string }[], confirmUnverified = false) =>
      send("/api/wallet-app/wallets/confirm", token, { proofs, confirmUnverified }),
    unlink: (token: string, address: string, confirmPrimary = false) =>
      send("/api/wallet-app/wallets/unlink", token, { address, confirmPrimary }),
    disconnect: (token: string) => send("/api/wallet-app/discord/disconnect", token, {}),
  };
}
