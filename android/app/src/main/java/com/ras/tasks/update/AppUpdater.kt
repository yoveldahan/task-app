package com.ras.tasks.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class UpdateException(message: String) : Exception(message)

/** Fetches version.json, downloads the new APK, checks its SHA-256, and opens the system installer. */
object AppUpdater {
    const val VERSION_URL = "https://yoveltask.netlify.app/version.json"

    /** Returns null on any network or format problem: the banner just doesn't show. */
    suspend fun fetchInfo(): UpdateInfo? = withContext(Dispatchers.IO) {
        runCatching {
            val connection = open(URL("$VERSION_URL?t=${System.currentTimeMillis()}"))
            try {
                if (connection.responseCode != HttpURLConnection.HTTP_OK) return@runCatching null
                Updates.parse(connection.inputStream.bufferedReader().use { it.readText() })
            } finally {
                connection.disconnect()
            }
        }.getOrNull()
    }

    /** Downloads the APK into the app's cache and deletes it again if its hash is wrong. */
    suspend fun download(context: Context, info: UpdateInfo): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val target = File(dir, "ras-update.apk")
        target.delete()
        val connection = open(URL(info.apkUrl))
        try {
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                throw UpdateException("ההורדה נכשלה (קוד ${connection.responseCode}).")
            }
            connection.inputStream.use { input -> target.outputStream().use { input.copyTo(it) } }
        } catch (e: java.io.IOException) {
            target.delete()
            throw UpdateException("ההורדה נכשלה. בדוק את החיבור ונסה שוב.")
        } finally {
            connection.disconnect()
        }
        if (!Updates.hashMatches(Updates.sha256Hex(target), info.sha256)) {
            target.delete()
            throw UpdateException("קובץ העדכון לא תקין (חתימה לא תואמת). הקובץ נמחק, נסה שוב מאוחר יותר.")
        }
        target
    }

    /** Android asks the user once to allow installs from this app ("התקנה ממקורות לא מוכרים"). */
    fun canInstall(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun unknownSourcesSettings(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))

    fun install(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private fun open(url: URL): HttpURLConnection = (url.openConnection() as HttpURLConnection).apply {
        useCaches = false
        setRequestProperty("Cache-Control", "no-cache")
        connectTimeout = 15_000
        readTimeout = 30_000
    }
}
