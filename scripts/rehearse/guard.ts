/** Public rehearsal chains. Ethereum and Base are refused before any key is read. */
export const REHEARSAL_CHAINS = [84532, 11155111] as const;

export function assertRehearsalChain(chainId: number): void {
  if (chainId === 1 || chainId === 8453 || !REHEARSAL_CHAINS.includes(chainId as (typeof REHEARSAL_CHAINS)[number])) {
    throw new Error(`Refusing chain ${chainId}. Rehearsal runs on Base Sepolia or Sepolia only.`);
  }
}
