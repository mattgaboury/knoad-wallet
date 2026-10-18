import { getAddress, type Address } from "viem";

/** What one chain currently authorizes. A rotation or recovery on another chain does not change it. */
export type ChainAuthorityView = {
  chainId: number;
  name: string;
  checked: boolean;
  deployed: boolean;
  /** This chain's own first spending key is still the one it would obey, including before deployment. */
  initialHotLive: boolean;
  recoveryAuthority: Address | null;
  recoveryEpoch: bigint | null;
};

export function sameAddress(left: Address, right: Address): boolean {
  return getAddress(left) === getAddress(right);
}

/** An undeployed chain has not installed a key yet, so its first key is still the one that can be installed. */
export function initialHotIsLive(args: { deployed: boolean; hotSigner: Address | null; initialHot: Address }): boolean {
  if (!args.deployed || !args.hotSigner) return true;
  return sameAddress(args.hotSigner, args.initialHot);
}

/** Chains whose own first key is still current, after some other chain has already moved on. */
export function chainsToRetire(views: readonly ChainAuthorityView[]): ChainAuthorityView[] {
  const retiredSomewhere = views.some((view) => view.checked && view.deployed && !view.initialHotLive);
  if (!retiredSomewhere) return [];
  return views.filter((view) => view.checked && view.initialHotLive);
}

/**
 * A deployed chain can be brought forward in one recovery when it is exactly one epoch
 * behind the authority this phone already holds. A bigger gap stays listed, not jumped.
 */
export function chainsOneRecoveryBehind(
  views: readonly ChainAuthorityView[],
  vaultEpoch: bigint,
): ChainAuthorityView[] {
  if (vaultEpoch <= 0n) return [];
  return views.filter(
    (view) => view.checked && view.deployed && view.recoveryEpoch !== null && view.recoveryEpoch + 1n === vaultEpoch,
  );
}

export function chainsRecoveryBehind(views: readonly ChainAuthorityView[], vaultEpoch: bigint): ChainAuthorityView[] {
  if (vaultEpoch <= 0n) return [];
  return views.filter((view) => {
    if (!view.checked) return false;
    if (!view.deployed) return true;
    return view.recoveryEpoch !== null && view.recoveryEpoch < vaultEpoch;
  });
}

/** Every checked chain that would still obey its own first spending key. */
export function chainsStillOnFirstKey(views: readonly ChainAuthorityView[]): ChainAuthorityView[] {
  return views.filter((view) => view.checked && view.initialHotLive);
}

export type ChainCutoffAction =
  | "not-checked"
  | "already-here"
  | "recover-one-step"
  | "deploy-and-retire"
  | "one-step-of-longer-gap";

/**
 * The epoch this sitting is aiming at.
 * A phone that already holds an authority ahead of the chains catches them up to it.
 * Otherwise the leading chains move forward one step.
 */
export function cutoffTarget(views: readonly ChainAuthorityView[], heldEpoch: bigint): bigint {
  let max = 0n;
  for (const view of views) {
    if (view.checked && view.deployed && view.recoveryEpoch !== null && view.recoveryEpoch > max) {
      max = view.recoveryEpoch;
    }
  }
  if (heldEpoch > 0n && max <= heldEpoch) return heldEpoch;
  return max + 1n;
}

export function classifyChainCutoff(view: ChainAuthorityView, targetEpoch: bigint): ChainCutoffAction {
  if (!view.checked) return "not-checked";
  if (!view.deployed) return "deploy-and-retire";
  if (view.recoveryEpoch === null) return "not-checked";
  if (view.recoveryEpoch >= targetEpoch) return "already-here";
  if (view.recoveryEpoch + 1n === targetEpoch) return "recover-one-step";
  return "one-step-of-longer-gap";
}

/** One step from the chain's own epoch. A longer gap is not jumped in a single call. */
export function recoveryInstallEpoch(view: ChainAuthorityView, targetEpoch: bigint): bigint | null {
  const action = classifyChainCutoff(view, targetEpoch);
  if ((action !== "recover-one-step" && action !== "one-step-of-longer-gap") || view.recoveryEpoch === null) return null;
  return view.recoveryEpoch + 1n;
}

export type SecureNetworkStatus = "closed" | "self-funded" | "needs-outside-payer" | "not-checked";

export type SecureNetworkReason = "tokens" | "empty";

export type SecureNetworkFacts = {
  checked: boolean;
  deployed: boolean;
  /** This phone already holds the key, or a funded first use was submitted. */
  secured: boolean;
  nativeBalance: bigint;
  holdsTokens: boolean;
  tokensKnown: boolean;
};

/** How an optional secure-all sitting treats one chain. Normal restore does not require the outside payment. */
export function classifySecureNetwork(facts: SecureNetworkFacts): {
  status: SecureNetworkStatus;
  reason?: SecureNetworkReason;
} {
  if (!facts.checked) return { status: "not-checked" };
  if (facts.secured || facts.deployed) return { status: "closed" };
  if (facts.nativeBalance > 0n) return { status: "self-funded" };
  if (facts.holdsTokens) return { status: "needs-outside-payer", reason: "tokens" };
  if (!facts.tokensKnown) return { status: "not-checked" };
  return { status: "needs-outside-payer", reason: "empty" };
}

/** Every epoch that must sign, from the chain's current epoch up to but not including the target. */
export function recoverySteps(chainEpoch: bigint, targetEpoch: bigint): bigint[] {
  const steps: bigint[] = [];
  for (let epoch = chainEpoch; epoch < targetEpoch; epoch += 1n) steps.push(epoch);
  return steps;
}
