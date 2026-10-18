import { getAddress, type Address } from "viem";
import { clampFeeBps, DEFAULT_FEE_BPS } from "../../../packages/core/src/commerce";

export type FeeConfig = { bps: number; recipient: Address | null };

export function feeConfig(env: Record<string, string | undefined>): FeeConfig {
  const raw = env.KNOAD_FEE_RECIPIENT?.trim();
  if (!raw) return { bps: 0, recipient: null };
  const bps = env.KNOAD_FEE_BPS === undefined || env.KNOAD_FEE_BPS === "" ? DEFAULT_FEE_BPS : Number(env.KNOAD_FEE_BPS);
  return { bps: clampFeeBps(bps), recipient: getAddress(raw) };
}
