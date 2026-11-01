package com.ras.tasks

import android.Manifest
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.ras.tasks.data.Supabase

import com.ras.tasks.speech.SpeechBridge
import com.ras.tasks.update.AppUpdater
import com.ras.tasks.update.UpdateException
import com.ras.tasks.update.UpdateInfo
import com.ras.tasks.update.Updates
import com.ras.tasks.ui.LoginScreen
import io.github.jan.supabase.auth.auth

/**
 * Hosts the task site (yoveltask.netlify.app) in a WebView, plus the native sign-in screen.
 * The widget and the reminders open this activity: a task opens that task, and a widget tap
 * without a widget sign-in starts on the sign-in screen.
 */
class MainActivity : ComponentActivity() {

    companion object {
        /** Sent by the widget when it has no sign-in yet. */
        const val ACTION_WIDGET_LOGIN = "com.ras.tasks.action.WIDGET_LOGIN"

        /** Sent by widget rows and reminder notifications; the task id is in the data URI. */
        const val ACTION_OPEN_TASK = "com.ras.tasks.action.OPEN_TASK"

        private const val PREFS = "app"
        private const val KEY_INTRO_SEEN = "intro_seen"
        private const val KEY_SETUP_SEEN = "setup_seen"
        private const val KEY_UPDATE_CHECKED = "update_checked_at"
        private const val SITE_HOST = "yoveltask.netlify.app"
        private const val SITE_ORIGIN = "https://yoveltask.netlify.app"
        private const val SITE_URL = "$SITE_ORIGIN/"
        private val EXTERNAL_SCHEMES = setOf("http", "https", "mailto", "tel")

        fun loginIntent(context: Context): Intent =
            Intent(context, MainActivity::class.java).apply { action = ACTION_WIDGET_LOGIN }

        /** Opens the site on one task. "openTask" (not "task", which adds a task from a link) is read by App.tsx. */
        private fun taskUrl(taskId: String): String = "$SITE_URL?openTask=${Uri.encode(taskId)}"
    }

    private enum class Screen { Loading, Login, Web }

    private val loadFailed = mutableStateOf(false)
    private val refreshing = mutableStateOf(false)
    private val targetUrl = mutableStateOf<String?>(null)
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var webViewInstance: WebView? = null

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pendingFileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        pendingFileCallback = null
    }

    private val notificationsPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        speech.onPermissionResult(granted)
    }

    private val speech: SpeechBridge by lazy {
        SpeechBridge(this) { microphonePermission.launch(Manifest.permission.RECORD_AUDIO) }
    }

    private val webView: WebView
        get() = webViewInstance ?: createWebView().also { webViewInstance = it }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            notificationsPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            MaterialTheme {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    AppRoot(showLogin = intent?.action == ACTION_WIDGET_LOGIN)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_WIDGET_LOGIN) {
            // The sign-in screen is chosen on start, so restart the activity to show it.
            recreate()
        } else {
            handleIntent(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        if (webViewInstance == null) return
        webView.onResume()
        // The widget changed a task: reload so the site shows the new state.
        if (AppState.consumeWidgetChange(this) && webView.url != null) webView.reload()
    }

    override fun onPause() {
        super.onPause()
        webViewInstance?.onPause()
    }

    override fun onDestroy() {
        speech.release()
        super.onDestroy()
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action != ACTION_OPEN_TASK) return
        val taskId = intent.data?.host?.let { Uri.decode(it) }?.takeIf { it.isNotBlank() } ?: return
        targetUrl.value = taskUrl(taskId)
    }

    @Composable
    private fun AppRoot(showLogin: Boolean) {
        val context = LocalContext.current
        val prefs = remember { context.getSharedPreferences(PREFS, MODE_PRIVATE) }
        var screen by remember { mutableStateOf(Screen.Loading) }
        var showSetup by remember { mutableStateOf(false) }
        var updateInfo by remember { mutableStateOf<UpdateInfo?>(null) }
        var showUpdateDialog by remember { mutableStateOf(false) }

        LaunchedEffect(Unit) {
            val auth = Supabase.get(context).auth
            auth.loadFromStorage()
            val signedIn = auth.currentSessionOrNull() != null
            screen = when {
                showLogin && !signedIn -> Screen.Login
                !prefs.getBoolean(KEY_INTRO_SEEN, false) -> Screen.Login
                else -> Screen.Web
            }
            if (screen == Screen.Web && !prefs.getBoolean(KEY_SETUP_SEEN, false)) showSetup = true
        }
        val leaveLogin = {
            prefs.edit().putBoolean(KEY_INTRO_SEEN, true).apply()
            screen = Screen.Web
            if (!prefs.getBoolean(KEY_SETUP_SEEN, false)) showSetup = true
        }
        val closeSetup = {
            prefs.edit().putBoolean(KEY_SETUP_SEEN, true).apply()
            showSetup = false
        }

        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
            when (screen) {
                Screen.Loading -> CircularProgressIndicator(Modifier.padding(24.dp))
                Screen.Login -> LoginScreen(onSignedIn = leaveLogin, onSkip = leaveLogin)
                Screen.Web -> WebScreen()
            }
            val available = updateInfo
            if (available != null && screen == Screen.Web && !showSetup) {
                Button(
                    onClick = { showUpdateDialog = true },
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
                ) { Text("עדכון זמין (${available.versionName})") }
            }
        }
        // Once a day, and never while a message is open or the sign-in screen is showing.
        LaunchedEffect(screen, showSetup, showUpdateDialog) {
            if (screen != Screen.Web || showSetup || showUpdateDialog) return@LaunchedEffect
            val now = System.currentTimeMillis()
            if (!Updates.shouldCheck(prefs.getLong(KEY_UPDATE_CHECKED, 0), now)) return@LaunchedEffect
            val info = AppUpdater.fetchInfo() ?: return@LaunchedEffect
            prefs.edit().putLong(KEY_UPDATE_CHECKED, now).apply()
            if (Updates.isNewer(info, BuildConfig.VERSION_CODE)) updateInfo = info
        }
        val available = updateInfo
        if (showUpdateDialog && available != null) {
            UpdateDialog(available, onClose = { showUpdateDialog = false })
        }
        if (showSetup) ReminderSetupDialog(onDone = closeSetup)
    }

    /** Downloads the update, checks its SHA-256 and opens the installer. */
    @Composable
    private fun UpdateDialog(info: UpdateInfo, onClose: () -> Unit) {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        var busy by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { if (!busy) onClose() },
            title = { Text("עדכון ל-${info.versionName}") },
            text = {
                Column {
                    Text("ההורדה נבדקת לפי חתימה (SHA-256) לפני ההתקנה.")
                    Text(
                        "אם המערכת מבקשת אישור \"התקנה ממקורות לא מוכרים\", אשר אותו. זה נדרש רק בפעם הראשונה.",
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    if (busy) Text("מוריד…", modifier = Modifier.padding(top = 8.dp))
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
                }
            },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    if (!AppUpdater.canInstall(context)) {
                        // Allow installs from this app first; the user taps again afterwards.
                        context.startActivity(AppUpdater.unknownSourcesSettings(context))
                        error = "אשר את ההתקנה ממקורות לא מוכרים לאפליקציה, ואז לחץ שוב."
                        return@TextButton
                    }
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            val apk = AppUpdater.download(context, info)
                            AppUpdater.install(context, apk)
                            onClose()
                        } catch (e: UpdateException) {
                            error = e.message
                        } catch (e: Exception) {
                            error = "העדכון נכשל. נסה שוב."
                        } finally {
                            busy = false
                        }
                    }
                }) { Text("הורד והתקן") }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = onClose) { Text("לא עכשיו") }
            },
        )
    }

    /** Explains the two settings that make reminders arrive on time. Shown once. */
    @Composable
    private fun ReminderSetupDialog(onDone: () -> Unit) {
        AlertDialog(
            onDismissRequest = onDone,
            title = { Text("תזכורות בזמן") },
            text = {
                Text(
                    "כדי שהתזכורות יגיעו בשעה המדויקת, כדאי:\n" +
                        "• לאשר \"התראות ותזכורות מדויקות\" (אם תתבקש).\n" +
                        "• לא להגביל את האפליקציה בחיסכון סוללה.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    openBatterySettings()
                    onDone()
                }) { Text("חיסכון סוללה") }
            },
            dismissButton = {
                Row {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        TextButton(onClick = {
                            openExactAlarmSettings()
                            onDone()
                        }) { Text("תזכורות מדויקות") }
                    }
                    TextButton(onClick = onDone) { Text("לא עכשיו") }
                }
            },
        )
    }

    @Composable
    private fun WebScreen() {
        LaunchedEffect(targetUrl.value) {
            val url = targetUrl.value
            when {
                url != null -> {
                    targetUrl.value = null
                    webView.loadUrl(url)
                }
                webView.url == null -> webView.loadUrl(SITE_URL)
            }
        }
        BackHandler {
            if (webView.canGoBack()) webView.goBack() else finish()
        }

        Box(Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    SwipeRefreshLayout(context).apply {
                        addView(webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                        setOnRefreshListener {
                            refreshing.value = true
                            reloadSite()
                        }
                        // Pull-to-refresh only when the page is scrolled to the top.
                        setOnChildScrollUpCallback { _, _ -> webView.canScrollVertically(-1) }
                    }
                },
                update = { it.isRefreshing = refreshing.value },
            )
            if (loadFailed.value) {
                OfflineMessage(onRetry = { reloadSite() })
            }
        }
    }

    @Composable
    private fun OfflineMessage(onRetry: () -> Unit) {
        Column(
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("אין חיבור לאינטרנט", style = MaterialTheme.typography.headlineSmall)
            Text("בדוק את החיבור ונסה שוב.", modifier = Modifier.padding(top = 8.dp))
            Button(onClick = onRetry, modifier = Modifier.padding(top = 16.dp)) { Text("נסה שוב") }
        }
    }

    private fun reloadSite() {
        loadFailed.value = false
        if (webView.url == null) webView.loadUrl(SITE_URL) else webView.reload()
    }

    private fun createWebView(): WebView {
        val view = WebView(this)
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        setUpSpeech(view)
        view.addJavascriptInterface(DownloadBridge(this), DownloadBridge.INTERFACE_NAME)
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                // Only top-level links to other sites leave the app; the site's own links stay inside.
                if (!request.isForMainFrame || uri.host == SITE_HOST || uri.scheme !in EXTERNAL_SCHEMES) return false
                openExternally(uri)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                loadFailed.value = false
            }

            override fun onPageFinished(view: WebView, url: String?) {
                refreshing.value = false
                view.evaluateJavascript(DownloadBridge.BLOB_DOWNLOAD_SCRIPT, null)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    refreshing.value = false
                    loadFailed.value = true
                }
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            // <input type="file"> (e.g. the settings backup import).
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = filePathCallback
                return try {
                    fileChooser.launch(fileChooserParams.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    pendingFileCallback = null
                    false
                }
            }
        }
        view.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }
        return view
    }

    /** Installs the voice shim and its native channel, for the site's origin only. */
    private fun setUpSpeech(view: WebView) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view, SpeechBridge.CHANNEL, setOf(SITE_ORIGIN)) { _, message, _, _, replyProxy ->
                speech.onMessage(message.data.orEmpty(), replyProxy)
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, SpeechBridge.SHIM_SCRIPT, setOf(SITE_ORIGIN))
        }
    }

    private fun openBatterySettings() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "לא ניתן לפתוח את ההגדרות", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "אין אפליקציה שיכולה לפתוח את הקישור", Toast.LENGTH_SHORT).show()
        }
    }

    private fun startDownload(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
        try {
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .addRequestHeader("User-Agent", userAgent)
                .setTitle(fileName)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            getSystemService<DownloadManager>()?.enqueue(request)
            Toast.makeText(this, "ההורדה התחילה: $fileName", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "ההורדה נכשלה", Toast.LENGTH_SHORT).show()
        }
    }
}
