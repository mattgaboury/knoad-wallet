import { COINGECKO_API_KEY } from "./config";

export type Spot = {
  eth: number | null;
  ethChange: number | null;
  usdc: number | null;
  usdcChange: number | null;
};

export type RangeKey = "1D" | "1W" | "1M" | "1Y";

const DAYS: Record<RangeKey, number> = { "1D": 1, "1W": 7, "1M": 30, "1Y": 365 };

type Cache = {
  spot?: { at: number; value: Spot };
  history: Partial<Record<RangeKey, { at: number; eth: number[]; usdc: number[] }>>;
};

const cache: Cache = { history: {} };
const FRESH = 60_000;

function priceHeaders(): HeadersInit {
  return COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {};
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: priceHeaders() });
  if (!response.ok) throw new Error("Price feed unavailable.");
  return response.json();
}

export async function loadSpot(): Promise<Spot | null> {
  if (cache.spot && Date.now() - cache.spot.at < FRESH) return cache.spot.value;
  try {
    const body = (await getJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,usd-coin&vs_currencies=usd&include_24hr_change=true",
    )) as {
      ethereum?: { usd?: number; usd_24h_change?: number };
      "usd-coin"?: { usd?: number; usd_24h_change?: number };
    };
    const value: Spot = {
      eth: typeof body.ethereum?.usd === "number" ? body.ethereum.usd : null,
      ethChange: typeof body.ethereum?.usd_24h_change === "number" ? body.ethereum.usd_24h_change : null,
      usdc: typeof body["usd-coin"]?.usd === "number" ? body["usd-coin"].usd : null,
      usdcChange: typeof body["usd-coin"]?.usd_24h_change === "number" ? body["usd-coin"].usd_24h_change : null,
    };
    cache.spot = { at: Date.now(), value };
    return value;
  } catch {
    return cache.spot?.value ?? null;
  }
}

function series(body: unknown): number[] {
  const prices = (body as { prices?: [number, number][] }).prices ?? [];
  const values = prices.map((point) => point[1]).filter((value) => Number.isFinite(value));
  if (values.length <= 32) return values;
  const step = (values.length - 1) / 31;
  const sampled: number[] = [];
  for (let index = 0; index < 32; index += 1) sampled.push(values[Math.round(index * step)] ?? values[values.length - 1]);
  return sampled;
}

export async function loadHistory(range: RangeKey): Promise<{ eth: number[]; usdc: number[] } | null> {
  const hit = cache.history[range];
  if (hit && Date.now() - hit.at < FRESH) return { eth: hit.eth, usdc: hit.usdc };
  const days = DAYS[range];
  try {
    const [ethBody, usdcBody] = await Promise.all([
      getJson(`https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${days}`),
      getJson(`https://api.coingecko.com/api/v3/coins/usd-coin/market_chart?vs_currency=usd&days=${days}`).catch(() => ({ prices: [] })),
    ]);
    const eth = series(ethBody);
    let usdc = series(usdcBody);
    if (usdc.length === 0 && eth.length > 0) usdc = eth.map(() => 1);
    if (eth.length < 2) return null;
    cache.history[range] = { at: Date.now(), eth, usdc };
    return { eth, usdc };
  } catch {
    return hit ? { eth: hit.eth, usdc: hit.usdc } : null;
  }
}

export function portfolioSeries(ethAmount: number, usdcAmount: number, eth: number[], usdc: number[]): number[] {
  const length = Math.min(eth.length, usdc.length || eth.length);
  const points: number[] = [];
  for (let index = eth.length - length; index < eth.length; index += 1) {
    const ethPrice = eth[index] ?? 0;
    const usdcPrice = usdc[index - (eth.length - length)] ?? usdc[usdc.length - 1] ?? 1;
    points.push(ethAmount * ethPrice + usdcAmount * usdcPrice);
  }
  return points;
}
