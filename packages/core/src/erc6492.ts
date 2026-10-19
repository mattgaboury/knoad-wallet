import { concat, encodeAbiParameters, getAddress, type Address, type Hex } from "viem";

/** Suffix a verifier uses to recognize a counterfactual signature. */
export const ERC6492_MAGIC =
  "0x6492649264926492649264926492649264926492649264926492649264926492" as Hex;

/** The factory call inside an ERC-4337 init code, without the factory address. */
export function callDataFromInitCode(factory: Address, initCode: Hex): Hex {
  const prefix = getAddress(factory).toLowerCase();
  if (!initCode.toLowerCase().startsWith(prefix)) {
    throw new Error("The setup code does not start with the factory.");
  }
  const data = `0x${initCode.slice(prefix.length)}` as Hex;
  if (data === "0x") throw new Error("The setup code is missing the factory call.");
  return data;
}

/**
 * Wraps a signature so a verifier can deploy the account in a simulation,
 * then check it. A deployed account keeps the raw signature.
 */
export function wrapErc6492Signature(args: { factory: Address; factoryCalldata: Hex; signature: Hex }): Hex {
  return concat([
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
      [getAddress(args.factory), args.factoryCalldata, args.signature],
    ),
    ERC6492_MAGIC,
  ]);
}
