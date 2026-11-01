package com.ras.tasks.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Shows task reminders in the "תזכורות" channel. */
object ReminderNotifier {
    const val CHANNEL_ID = "reminders"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "תזכורות", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "תזכורות למשימות מהאתר" }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** Returns false when the notification could not be shown (no permission), so the reminder stays unmarked. */
    fun show(context: Context, taskId: String, title: String, body: String, timeText: String): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        val tap = PendingIntent.getActivity(
            context,
            taskId.hashCode(),
            openTaskIntent(context, taskId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(body)
            .setSubText("תזכורת לשעה $timeText")
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        return try {
            NotificationManagerCompat.from(context).notify(taskId.hashCode(), notification)
            true
        } catch (e: SecurityException) {
            false
        }
    }
}
