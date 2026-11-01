package com.ras.tasks.data

import android.content.Context
import com.ras.tasks.BuildConfig
import com.ras.tasks.auth.EncryptedSessionManager
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.ktor.client.engine.okhttp.OkHttp

/** One Supabase client per process, created on first use. */
object Supabase {
    @Volatile
    private var client: SupabaseClient? = null

    fun get(context: Context): SupabaseClient =
        client ?: synchronized(this) {
            client ?: create(context.applicationContext).also { client = it }
        }

    private fun create(context: Context): SupabaseClient =
        createSupabaseClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY) {
            httpEngine = OkHttp.create()
            install(Auth) { sessionManager = EncryptedSessionManager(context) }
            install(Postgrest)
        }
}
