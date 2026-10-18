import { p256 } from "@noble/curves/p256";
import { bytesToHex, concat, getAddress, hexToBytes, keccak256, type Address, type Hex } from "viem";
import { KEY_P256, type KeyType } from "./types";

export type P256Key = {
  privateKey: Hex;
  qx: Hex;
  qy: Hex;
  signer: Address;
  keyType: KeyType;
};

export function p256SignerAddress(qx: Hex, qy: Hex): Address {
  const hash = keccak256(concat([pad32(qx), pad32(qy)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export function createP256Key(): P256Key {
  const privateKey = bytesToHex(p256.utils.randomPrivateKey());
  return p256FromPrivateKey(privateKey);
}

export function p256FromPrivateKey(privateKey: Hex): P256Key {
  const pub = p256.getPublicKey(hexToBytes(privateKey), false);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("Expected an uncompressed P-256 public key.");
  }
  const qx = bytesToHex(pub.slice(1, 33));
  const qy = bytesToHex(pub.slice(33, 65));
  return { privateKey, qx, qy, signer: p256SignerAddress(qx, qy), keyType: KEY_P256 };
}

/** 128-byte hot signature: r || s || qx || qy. Signs the digest, not a hash of it. */
export function signP256(privateKey: Hex, digest: Hex): Hex {
  const sig = p256.sign(hexToBytes(digest), hexToBytes(privateKey), { lowS: true, prehash: false });
  const compact = sig.toCompactRawBytes();
  if (compact.length !== 64) throw new Error("P-256 signature was not 64 bytes.");
  const { qx, qy } = p256FromPrivateKey(privateKey);
  return concat([bytesToHex(compact), qx, qy]);
}

function pad32(value: Hex): Hex {
  const body = value.slice(2).padStart(64, "0");
  if (body.length !== 64) throw new Error("P-256 coordinate is not 32 bytes.");
  return `0x${body}`;
}
