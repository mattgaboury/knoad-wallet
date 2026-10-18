export function shortAddress(value: string): string {
  if (!value.startsWith("0x") || value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-5)}`;
}

export function usd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function signedUsd(value: number): string {
  const body = usd(Math.abs(value));
  if (value < 0) return `-${body}`;
  if (value > 0) return `+${body}`;
  return body;
}

export function signedPercent(value: number): string {
  const text = `${Math.abs(value).toFixed(2)}%`;
  if (value > 0) return `+${text}`;
  if (value < 0) return `-${text}`;
  return text;
}

export function trimAmount(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

export function gwei(wei: string | bigint): string {
  try {
    const value = typeof wei === "bigint" ? wei : BigInt(wei);
    const whole = value / 1_000_000_000n;
    const frac = value % 1_000_000_000n;
    if (whole >= 10n) return `${whole.toString()} Gwei`;
    const digits = frac.toString().padStart(9, "0").slice(0, 2);
    return `${whole.toString()}.${digits} Gwei`;
  } catch {
    return "—";
  }
}

export function pendingFor(ms: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function daysAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function verifiedDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}

export function browseTarget(input: string): string {
  const text = input.trim();
  if (!text) return "";
  if (text.startsWith("wc:")) return text;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
