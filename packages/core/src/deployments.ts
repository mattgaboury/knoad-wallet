import { getAddress, type Address, type Hex } from "viem";
import { predictAccount } from "./account";
import deploymentsJson from "../../../test-vectors/deployments.json";

type DeploymentsFile = {
  deterministicDeployer: string;
  verifierSalt: string;
  factorySalt: string;
  verifier: string;
  factory: string;
  implementation: string;
  verifierInitCodeHash: string;
  factoryInitCodeHash: string;
  entryPoint: string;
  proxyCreationCode: string;
};

const file = deploymentsJson as DeploymentsFile;

/** Addresses produced by script/Deploy.s.sol. The same values on every chain. */
export const deployments = {
  deterministicDeployer: getAddress(file.deterministicDeployer),
  verifierSalt: file.verifierSalt as Hex,
  factorySalt: file.factorySalt as Hex,
  verifier: getAddress(file.verifier),
  factory: getAddress(file.factory),
  implementation: getAddress(file.implementation),
  verifierInitCodeHash: file.verifierInitCodeHash as Hex,
  factoryInitCodeHash: file.factoryInitCodeHash as Hex,
  entryPoint: getAddress(file.entryPoint),
  proxyCreationCode: file.proxyCreationCode as Hex,
};

export function predictDeployedAccount(args: { recovery: Address; index?: bigint }): Address {
  return predictAccount({
    factory: deployments.factory,
    implementation: deployments.implementation,
    proxyCreationCode: deployments.proxyCreationCode,
    recovery: args.recovery,
    index: args.index ?? 0n,
  });
}
