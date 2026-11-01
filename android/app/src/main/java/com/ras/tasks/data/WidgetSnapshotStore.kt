package com.ras.tasks.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ras.tasks.domain.OpenTask
import com.ras.tasks.domain.PendingCompletion
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val Context.widgetData by preferencesDataStore(name = "widget_snapshot")

/** What the widget shows. Written by the refresh worker and by optimistic completions. */
data class WidgetSnapshot(
    val signedIn: Boolean,
    val tasks: List<OpenTask>,
    val refreshing: Boolean = false,
    val status: String? = null,
)

/** Stores what the widget shows, and completions still waiting to reach Supabase. */
object WidgetSnapshotStore {
    private val SIGNED_IN = booleanPreferencesKey("signed_in")
    private val TASKS = stringPreferencesKey("tasks_json")
    private val PENDING = stringPreferencesKey("pending_json")
    private val REFRESHING_SINCE = longPreferencesKey("refreshing_since")
    private val STATUS = stringPreferencesKey("status")
    private val json = Json { ignoreUnknownKeys = true }
    private val taskList = ListSerializer(OpenTask.serializer())
    private val pendingList = ListSerializer(PendingCompletion.serializer())

    suspend fun save(context: Context, snapshot: WidgetSnapshot) {
        context.widgetData.edit {
            it[SIGNED_IN] = snapshot.signedIn
            it[TASKS] = json.encodeToString(taskList, snapshot.tasks)
        }
    }

    suspend fun read(context: Context): WidgetSnapshot {
        val prefs = context.widgetData.data.first()
        val tasks = prefs[TASKS]?.let { runCatching { json.decodeFromString(taskList, it) }.getOrNull() }
        return WidgetSnapshot(
            signedIn = prefs[SIGNED_IN] ?: false,
            tasks = tasks.orEmpty(),
            refreshing = isRefreshing(prefs[REFRESHING_SINCE]),
            status = prefs[STATUS],
        )
    }

    suspend fun setRefreshing(context: Context, refreshing: Boolean) {
        context.widgetData.edit { it[REFRESHING_SINCE] = if (refreshing) System.currentTimeMillis() else 0L }
    }

    /** A loading state older than this is stale (the run never finished), so the widget stops showing it. */
    private const val STALE_AFTER_MS = 90_000L

    private fun isRefreshing(since: Long?): Boolean =
        since != null && since > 0 && System.currentTimeMillis() - since < STALE_AFTER_MS

    /** A short message for the widget, or null to show nothing. */
    suspend fun setStatus(context: Context, status: String?) {
        context.widgetData.edit { if (status == null) it.remove(STATUS) else it[STATUS] = status }
    }

    suspend fun readPending(context: Context): List<PendingCompletion> {
        val raw = context.widgetData.data.first()[PENDING] ?: return emptyList()
        return runCatching { json.decodeFromString(pendingList, raw) }.getOrDefault(emptyList())
    }

    suspend fun writePending(context: Context, pending: List<PendingCompletion>) {
        context.widgetData.edit { it[PENDING] = json.encodeToString(pendingList, pending) }
    }
}
