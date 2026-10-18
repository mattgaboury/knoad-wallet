import {
  concat,
  encodeAbiParameters,
  getAddress,
  hashStruct,
  keccak256,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { DOMAIN_NAME, DOMAIN_VERSION } from "./types";

export type TypedDataField = { name: string; type: string };

export type TypedDataRequest = {
  domain: {
    name?: string;
    version?: string;
    chainId?: number | bigint | string;
    verifyingContract?: Address;
    salt?: Hex;
  };
  types: Record<string, readonly TypedDataField[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

const zeroHash = `0x${"00".repeat(32)}` as Hex;

/**
 * ERC-7739 TypedDataSign digest.
 * The hot key signs `digest`. The dapp receives the wrapped signature and
 * calls isValidSignature with `appHash`.
 */
export function erc7739TypedData(args: { account: Address; chainId: bigint; typedData: TypedDataRequest }): {
  digest: Hex;
  appHash: Hex;
  appSeparator: Hex;
  contentsHash: Hex;
  contentsDescr: string;
} {
  const types = withoutDomain(args.typedData.types);
  const primaryType = args.typedData.primaryType;
  if (!types[primaryType]) throw new Error("Typed data is missing its primary type.");

  const appSeparator = eip712DomainSeparator(args.typedData.domain);
  const contentsHash = hashStruct({
    data: args.typedData.message,
    primaryType,
    types,
  });
  const { contentsDescr, typedDataSignType } = contentsDetail(types, primaryType);
  const structHash = keccak256(
    concat([keccak256(toBytes(typedDataSignType)), contentsHash, accountDomainBytes(args.account, args.chainId)]),
  );
  return {
    digest: keccak256(concat(["0x1901", appSeparator, structHash])),
    appHash: keccak256(concat(["0x1901", appSeparator, contentsHash])),
    appSeparator,
    contentsHash,
    contentsDescr,
  };
}

export function encodeTypedDataSignature(args: {
  signature: Hex;
  appSeparator: Hex;
  contentsHash: Hex;
  contentsDescr: string;
}): Hex {
  const descr = toBytes(args.contentsDescr);
  if (descr.length > 0xffff) throw new Error("Typed data descriptor is too long.");
  return concat([
    args.signature,
    args.appSeparator,
    args.contentsHash,
    toHex(descr),
    toHex(descr.length, { size: 2 }),
  ]);
}

export function parseTypedDataRequest(value: unknown): TypedDataRequest | null {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  try {
    const parsed = JSON.parse(text) as Partial<TypedDataRequest>;
    if (!parsed || typeof parsed !== "object" || !parsed.types || typeof parsed.primaryType !== "string") return null;
    if (!parsed.domain || !parsed.message || typeof parsed.message !== "object") return null;
    return parsed as TypedDataRequest;
  } catch {
    return null;
  }
}

function accountDomainBytes(account: Address, chainId: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
    [keccak256(toBytes(DOMAIN_NAME)), keccak256(toBytes(DOMAIN_VERSION)), chainId, getAddress(account), zeroHash],
  );
}

function eip712DomainSeparator(domain: TypedDataRequest["domain"]): Hex {
  const fields: { name: string; type: string; value: unknown }[] = [];
  if (domain.name !== undefined) fields.push({ name: "name", type: "string", value: domain.name });
  if (domain.version !== undefined) fields.push({ name: "version", type: "string", value: domain.version });
  if (domain.chainId !== undefined) fields.push({ name: "chainId", type: "uint256", value: BigInt(domain.chainId) });
  if (domain.verifyingContract !== undefined) {
    fields.push({ name: "verifyingContract", type: "address", value: getAddress(domain.verifyingContract) });
  }
  if (domain.salt !== undefined) fields.push({ name: "salt", type: "bytes32", value: domain.salt });
  if (fields.length === 0) throw new Error("Typed data domain is empty.");

  const typeString = `EIP712Domain(${fields.map((field) => `${field.type} ${field.name}`).join(",")})`;
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, ...fields.map((field) => ({ type: field.type === "string" ? "bytes32" : field.type }))],
      [
        keccak256(toBytes(typeString)),
        ...fields.map((field) => (field.type === "string" ? keccak256(toBytes(String(field.value))) : field.value)),
      ],
    ),
  );
}

function contentsDetail(types: Record<string, readonly TypedDataField[]>, primaryType: string): {
  contentsDescr: string;
  typedDataSignType: string;
} {
  const allTypes: Record<string, readonly TypedDataField[]> = {
    TypedDataSign: [
      { name: "contents", type: primaryType },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    ...types,
  };
  const typedDataSignType = encodeType("TypedDataSign", allTypes);
  const contentsType = typedDataSignType.slice(typedDataSignType.indexOf(")") + 1);
  const contentsDescr = contentsType.startsWith(primaryType) ? contentsType : contentsType + primaryType;
  return { contentsDescr, typedDataSignType };
}

function encodeType(primaryType: string, types: Record<string, readonly TypedDataField[]>): string {
  const deps = new Set<string>();
  collect(primaryType, types, deps);
  deps.delete(primaryType);
  const ordered = [primaryType, ...Array.from(deps).sort()];
  return ordered
    .map((name) => `${name}(${(types[name] ?? []).map((field) => `${field.type} ${field.name}`).join(",")})`)
    .join("");
}

function collect(typeName: string, types: Record<string, readonly TypedDataField[]>, into: Set<string>): void {
  const name = typeName.match(/^\w*/u)?.[0] ?? "";
  if (!name || into.has(name) || !types[name]) return;
  into.add(name);
  for (const field of types[name]) collect(field.type, types, into);
}

function withoutDomain(types: Record<string, readonly TypedDataField[]>): Record<string, readonly TypedDataField[]> {
  const next = { ...types };
  delete next.EIP712Domain;
  return next;
}
