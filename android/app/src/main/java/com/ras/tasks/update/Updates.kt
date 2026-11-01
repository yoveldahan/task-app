package com.ras.tasks.update

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest

/** Contents of version.json on the site. */
@Serializable
data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
)

object Updates {
    private const val ONE_DAY_MS = 24L * 60 * 60 * 1000
    private val SHA256_HEX = Regex("[0-9a-fA-F]{64}")

    /** Parses version.json. Returns null if the file is malformed, or the URL or hash is not usable. */
    fun parse(json: String): UpdateInfo? {
        val info = runCatching { Json { ignoreUnknownKeys = true }.decodeFromString<UpdateInfo>(json) }.getOrNull()
            ?: return null
        val usable = info.apkUrl.startsWith("https://") && SHA256_HEX.matches(info.sha256) && info.versionCode > 0
        return info.takeIf { usable }
    }

    fun isNewer(info: UpdateInfo, currentVersionCode: Int): Boolean = info.versionCode > currentVersionCode

    /** At most one check a day. A clock that went backwards also allows a check. */
    fun shouldCheck(lastCheckMs: Long, nowMs: Long): Boolean =
        lastCheckMs <= 0 || nowMs < lastCheckMs || nowMs - lastCheckMs >= ONE_DAY_MS

    fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

    fun sha256Hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().toHex()
    }

    fun hashMatches(actual: String, expected: String): Boolean = actual.equals(expected, ignoreCase = true)

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
