package com.ras.tasks.data

import android.content.Context
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Local bookkeeping for reminders: which alarms are set, and which reminders were already shown here.
 * The website's reminder_fired_for is the shared record; this covers the time before it is written.
 */
class ReminderState(context: Context) {
    private val prefs = context.getSharedPreferences("reminders", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val map = MapSerializer(String.serializer(), String.serializer())

    var scheduled: Map<String, String>
        get() = read(KEY_SCHEDULED)
        set(value) = write(KEY_SCHEDULED, value)

    var fired: Map<String, String>
        get() = read(KEY_FIRED)
        set(value) = write(KEY_FIRED, value)

    /** Forgets the alarms: after a reboot AlarmManager has dropped them all. */
    fun clearScheduled() {
        scheduled = emptyMap()
    }

    private fun read(key: String): Map<String, String> =
        prefs.getString(key, null)?.let { runCatching { json.decodeFromString(map, it) }.getOrNull() }.orEmpty()

    private fun write(key: String, value: Map<String, String>) {
        prefs.edit().putString(key, json.encodeToString(map, value)).apply()
    }

    private companion object {
        const val KEY_SCHEDULED = "scheduled"
        const val KEY_FIRED = "fired"
    }
}
