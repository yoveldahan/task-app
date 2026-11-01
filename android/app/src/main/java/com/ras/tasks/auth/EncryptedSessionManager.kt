package com.ras.tasks.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.serialization.json.Json

/** Keeps the Supabase session encrypted on the device, so the sign-in survives app restarts and the widget can read it. */
class EncryptedSessionManager(context: Context) : SessionManager {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        FILE_NAME,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override suspend fun saveSession(session: UserSession) {
        prefs.edit().putString(KEY, Json.encodeToString(UserSession.serializer(), session)).apply()
    }

    override suspend fun loadSession(): UserSession? =
        prefs.getString(KEY, null)?.let { runCatching { Json.decodeFromString(UserSession.serializer(), it) }.getOrNull() }

    override suspend fun deleteSession() {
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val FILE_NAME = "supabase_session"
        const val KEY = "session"
    }
}
