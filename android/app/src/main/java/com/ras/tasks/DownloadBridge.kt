package com.ras.tasks

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File

/**
 * The site downloads backups from a blob: URL, which the WebView's DownloadListener can't fetch.
 * [BLOB_DOWNLOAD_SCRIPT] runs in the page, reads the blob, and hands it here as base64.
 */
class DownloadBridge(private val context: Context) {

    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun saveBase64(base64: String, fileName: String, mimeType: String) {
        try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val savedName = saveToDownloads(fileName, mimeType, bytes)
            toast("נשמר בהורדות: $savedName")
        } catch (e: Exception) {
            toast("השמירה נכשלה: $fileName")
        }
    }

    @JavascriptInterface
    fun fail(fileName: String) {
        toast("ההורדה נכשלה: $fileName")
    }

    private fun saveToDownloads(fileName: String, mimeType: String, bytes: ByteArray): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // MediaStore.Downloads starts at Android 10. Older devices write the file directly.
            val file = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), fileName)
            file.writeBytes(bytes)
            return file.name
        }
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("MediaStore insert failed")
        resolver.openOutputStream(uri)!!.use { it.write(bytes) }
        resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        // The name can change if a file with the same name already exists; show the real one.
        resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0)
        }
        return fileName
    }

    private fun toast(message: String) {
        main.post { Toast.makeText(context, message, Toast.LENGTH_LONG).show() }
    }

    companion object {
        /** Name of the JavaScript object the page script calls. */
        const val INTERFACE_NAME = "AndroidDownload"

        /** Intercepts `<a download>` clicks on blob: and data: URLs and sends the file to [DownloadBridge]. */
        const val BLOB_DOWNLOAD_SCRIPT = """
            (function () {
              if (window.__rasDownloadPatched) return;
              window.__rasDownloadPatched = true;
              var originalClick = HTMLAnchorElement.prototype.click;
              HTMLAnchorElement.prototype.click = function () {
                var href = this.href || '';
                var name = this.getAttribute('download');
                if (name !== null && (href.indexOf('blob:') === 0 || href.indexOf('data:') === 0)) {
                  var fileName = name || 'download';
                  fetch(href)
                    .then(function (response) { return response.blob(); })
                    .then(function (blob) {
                      var reader = new FileReader();
                      reader.onloadend = function () {
                        var result = String(reader.result);
                        var base64 = result.substring(result.indexOf(',') + 1);
                        window.$INTERFACE_NAME.saveBase64(base64, fileName, blob.type || 'application/octet-stream');
                      };
                      reader.readAsDataURL(blob);
                    })
                    .catch(function () { window.$INTERFACE_NAME.fail(fileName); });
                  return;
                }
                return originalClick.apply(this, arguments);
              };
            })();
        """
    }
}
