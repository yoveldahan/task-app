package com.ras.tasks.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.getSystemService
import com.ras.tasks.domain.ReminderDue

/** Sets and cancels one exact alarm per task reminder. */
object ReminderScheduler {
    private const val EXTRA_TASK_ID = "task_id"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_KEY = "key"
    private const val EXTRA_TIME = "time"

    fun schedule(context: Context, reminder: ReminderDue, time: String) {
        val taskId = reminder.taskId
        val alarms = context.getSystemService<AlarmManager>() ?: return
        val intent = Intent(context, ReminderReceiver::class.java)
            .putExtra(EXTRA_TASK_ID, taskId)
            .putExtra(EXTRA_TITLE, reminder.title)
            .putExtra(EXTRA_BODY, reminder.body)
            .putExtra(EXTRA_KEY, reminder.key)
            .putExtra(EXTRA_TIME, time)
        val pending = PendingIntent.getBroadcast(
            context,
            taskId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val at = reminder.dueAt.toEpochMilli()
        // Exact alarms need the "Alarms & reminders" permission from Android 14; without it, fall back to a near-exact alarm.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        }
    }

    fun cancel(context: Context, taskId: String) {
        val alarms = context.getSystemService<AlarmManager>() ?: return
        val existing = PendingIntent.getBroadcast(
            context,
            taskId.hashCode(),
            Intent(context, ReminderReceiver::class.java),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        ) ?: return
        alarms.cancel(existing)
        existing.cancel()
    }

    fun canScheduleExact(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || context.getSystemService<AlarmManager>()?.canScheduleExactAlarms() == true

    fun taskId(intent: Intent): String? = intent.getStringExtra(EXTRA_TASK_ID)
    fun title(intent: Intent): String = intent.getStringExtra(EXTRA_TITLE).orEmpty()
    fun body(intent: Intent): String = intent.getStringExtra(EXTRA_BODY).orEmpty()
    fun key(intent: Intent): String = intent.getStringExtra(EXTRA_KEY).orEmpty()
    fun time(intent: Intent): String = intent.getStringExtra(EXTRA_TIME).orEmpty()
}
