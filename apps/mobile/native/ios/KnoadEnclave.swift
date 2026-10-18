import Foundation
import Security

/// Secure Enclave P-256 key. The private key is not exportable.
/// A dev client copies the returned strings onto `globalThis.KnoadEnclave`.
enum KnoadEnclave {
    static func create() throws -> (id: String, qx: String, qy: String) {
        let id = UUID().uuidString
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: Data(id.utf8),
            ],
        ]
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw error!.takeRetainedValue() as Error
        }
        guard let publicKey = SecKeyCopyPublicKey(privateKey),
              let external = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw error!.takeRetainedValue() as Error
        }
        let body = external.count == 65 ? external.dropFirst() : external.suffix(64)
        return (id, body.prefix(32).hex, body.suffix(32).hex)
    }

    /// Signs a 32-byte digest. `ECDSASignatureDigestX962SHA256` does not hash again.
    static func sign(id: String, digestHex: String) throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: Data(id.utf8),
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let privateKey = item else {
            throw EnclaveError.missing
        }
        let digest = Data(hex: digestHex)
        var error: Unmanaged<CFError>?
        guard let der = SecKeyCreateSignature(
            privateKey as! SecKey,
            .ecdsaSignatureDigestX962SHA256,
            digest as CFData,
            &error
        ) as Data? else {
            throw error!.takeRetainedValue() as Error
        }
        let (r, s) = try lowS(parseDer(der))
        let publicKey = try publicPoint(privateKey as! SecKey)
        return "0x" + r.hex + s.hex + publicKey.qx + publicKey.qy
    }

    private static func publicPoint(_ privateKey: SecKey) throws -> (qx: String, qy: String) {
        var error: Unmanaged<CFError>?
        guard let publicKey = SecKeyCopyPublicKey(privateKey),
              let external = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw error!.takeRetainedValue() as Error
        }
        let body = external.count == 65 ? external.dropFirst() : external.suffix(64)
        return (body.prefix(32).hex, body.suffix(32).hex)
    }

    private static let n = Data(hex: "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551")

    private static func lowS(_ rs: (Data, Data)) throws -> (Data, Data) {
        var s = rs.1
        if s.count < 32 { s = Data(count: 32 - s.count) + s }
        if compare(s, halfN()) > 0 { s = subtract(n, s) }
        return (pad(rs.0), pad(s))
    }

    private static func halfN() -> Data { divideByTwo(n) }

    private static func pad(_ value: Data) -> Data {
        value.count >= 32 ? value.suffix(32) : Data(count: 32 - value.count) + value
    }

    private static func parseDer(_ der: Data) throws -> (Data, Data) {
        guard der.count > 6, der[0] == 0x30 else { throw EnclaveError.der }
        var index = 2
        guard der[index] == 0x02 else { throw EnclaveError.der }
        index += 1
        let rLen = Int(der[index])
        index += 1
        let r = der.subdata(in: index..<(index + rLen))
        index += rLen
        guard der[index] == 0x02 else { throw EnclaveError.der }
        index += 1
        let sLen = Int(der[index])
        index += 1
        let s = der.subdata(in: index..<(index + sLen))
        return (strip(r), strip(s))
    }

    private static func strip(_ value: Data) -> Data {
        var body = value
        while body.first == 0, body.count > 32 { body = body.dropFirst() }
        return body
    }

    private static func compare(_ lhs: Data, _ rhs: Data) -> Int {
        let a = pad(lhs)
        let b = pad(rhs)
        for i in 0..<32 {
            if a[i] != b[i] { return a[i] < b[i] ? -1 : 1 }
        }
        return 0
    }

    private static func divideByTwo(_ value: Data) -> Data {
        var out = Data(count: value.count)
        var carry = 0
        for i in 0..<value.count {
            let byte = Int(value[i]) + carry * 256
            out[i] = UInt8(byte / 2)
            carry = byte % 2
        }
        return out
    }

    private static func subtract(_ lhs: Data, _ rhs: Data) -> Data {
        var out = Data(count: 32)
        var borrow = 0
        let a = pad(lhs)
        let b = pad(rhs)
        for i in stride(from: 31, through: 0, by: -1) {
            var diff = Int(a[i]) - Int(b[i]) - borrow
            if diff < 0 {
                diff += 256
                borrow = 1
            } else {
                borrow = 0
            }
            out[i] = UInt8(diff)
        }
        return out
    }
}

private enum EnclaveError: Error { case missing, der }

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }

    init(hex: String) {
        let raw = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
        var data = Data()
        var index = raw.startIndex
        while index < raw.endIndex {
            let next = raw.index(index, offsetBy: 2)
            data.append(UInt8(raw[index..<next], radix: 16)!)
            index = next
        }
        self = data
    }
}
