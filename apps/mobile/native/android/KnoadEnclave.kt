package io.knoad.wallet

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID

/**
 * Android Keystore P-256 key. StrongBox is requested and dropped if the device
 * has no StrongBox. The private key stays in the keystore.
 * NONEwithECDSA signs the 32-byte digest the account expects.
 */
object KnoadEnclave {
    private const val PROVIDER = "AndroidKeyStore"
    private val n = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)

    fun create(): Triple<String, String, String> {
        val id = UUID.randomUUID().toString()
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
        val base = KeyGenParameterSpec.Builder(id, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_NONE)
        try {
            generator.initialize(base.setIsStrongBoxBacked(true).build())
            generator.generateKeyPair()
        } catch (_: Exception) {
            generator.initialize(base.setIsStrongBoxBacked(false).build())
            generator.generateKeyPair()
        }
        val point = publicPoint(id)
        return Triple(id, point.first, point.second)
    }

    fun sign(id: String, digestHex: String): String {
        val key = keyStore().getKey(id, null)
        val signature = Signature.getInstance("NONEwithECDSA")
        signature.initSign(key)
        signature.update(hexToBytes(digestHex))
        val (r, s) = derToRs(signature.sign())
        val lowS = if (s > n.shiftRight(1)) n.subtract(s) else s
        val (qx, qy) = publicPoint(id)
        return "0x" + fixed(r) + fixed(lowS) + qx.removePrefix("0x") + qy.removePrefix("0x")
    }

    private fun publicPoint(id: String): Pair<String, String> {
        val publicKey = keyStore().getCertificate(id).publicKey as ECPublicKey
        return "0x" + fixed(publicKey.w.affineX) to "0x" + fixed(publicKey.w.affineY)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    private fun derToRs(der: ByteArray): Pair<BigInteger, BigInteger> {
        var i = 2
        require(der[0] == 0x30.toByte() && der[i] == 0x02.toByte())
        i += 1
        val rLen = der[i].toInt() and 0xff
        i += 1
        val r = BigInteger(1, der.copyOfRange(i, i + rLen))
        i += rLen
        require(der[i] == 0x02.toByte())
        i += 1
        val sLen = der[i].toInt() and 0xff
        i += 1
        val s = BigInteger(1, der.copyOfRange(i, i + sLen))
        return r to s
    }

    private fun fixed(value: BigInteger): String = value.toString(16).padStart(64, '0').takeLast(64)

    private fun hexToBytes(hex: String): ByteArray {
        val raw = hex.removePrefix("0x")
        return ByteArray(raw.length / 2) { index -> raw.substring(index * 2, index * 2 + 2).toInt(16).toByte() }
    }
}
