/**
 * A WalletConnect button opens `knoad://wc?uri=wc:...`.
 * A full code carries `symKey`. The short `wc:<topic>@2` form only brings the app forward.
 */
export function pairingCodeFromLink(url: string): string | null {
  const code = wcValue(url);
  if (!code || !hasSymKey(code)) return null;
  return code;
}

export function isWalletConnectLink(url: string): boolean {
  return wcValue(url) !== null;
}

function wcValue(url: string): string | null {
  const text = url.trim();
  if (!text) return null;
  if (text.startsWith("wc:")) return text;
  const marker = /[?&#]uri=/i.exec(text);
  if (!marker) return null;
  let value = text.slice(marker.index + marker[0].length);
  for (let i = 0; i < 2 && value.includes("%"); i += 1) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value.startsWith("wc:") ? value : null;
}

function hasSymKey(code: string): boolean {
  return /[?&]symKey=[^&]+/i.test(code);
}
