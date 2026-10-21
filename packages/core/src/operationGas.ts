import { KEY_P256, type KeyType } from "./types";

export type OperationGas = {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
};

/** Used when no bundler is configured, and by the hash fixtures. Not a quote. */
export function defaultTestGas(keyType?: KeyType): OperationGas {
  return {
    verificationGasLimit: keyType === KEY_P256 ? 8_000_000n : 1_000_000n,
    callGasLimit: 1_000_000n,
    preVerificationGas: 100_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
  };
}
