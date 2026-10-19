import { shortAddress, verifiedDate } from "./format";

export function spendingKeyLine(args: {
  deployed: boolean;
  pending: boolean;
  generation: string;
  signer: string | null;
  since: number | null;
}): string {
  if (args.pending) return "A new spending key is waiting for this send.";
  const generation = Number(args.generation);
  if (!args.deployed || !Number.isFinite(generation) || generation <= 0 || !args.signer) {
    return "First spending key. It changes on the first send.";
  }
  const when = args.since && args.since > 0 ? verifiedDate(args.since) : "";
  const head = `Spending key ${generation} · ${shortAddress(args.signer)}`;
  return when ? `${head} · ${when}` : head;
}
