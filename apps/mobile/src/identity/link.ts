/** Pulls the one-time Discord code out of an app return without treating a WalletConnect URI as one. */
export function identityCodeFromLink(url: string): { code: string; state: string } | null {
  const text = url.trim();
  if (!text || text.startsWith("wc:") || /[?&#]uri=/i.test(text)) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  const httpsReturn =
    parsed.protocol === "https:" &&
    (parsed.host === "knoad.io" || parsed.host === "www.knoad.io") &&
    parsed.pathname === "/wallet/discord";
  const appReturn = parsed.protocol === "knoad:" && parsed.host === "discord";
  if (!httpsReturn && !appReturn) return null;
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (!code || !state) return null;
  return { code, state };
}
