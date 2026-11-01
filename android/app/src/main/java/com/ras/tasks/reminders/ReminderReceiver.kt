package com.ras.tasks.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.ras.tasks.data.ReminderState
import com.ras.tasks.work.MarkFiredWorker

/** Fires when a reminder's alarm goes off: shows the notification, then records it as fired. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val taskId = ReminderScheduler.taskId(intent) ?: return
        val key = ReminderScheduler.key(intent)
        val state = ReminderState(context)
        state.scheduled = state.scheduled - taskId
        val shown = ReminderNotifier.show(
            context,
            taskId,
            ReminderScheduler.title(intent),
            ReminderScheduler.body(intent),
            ReminderScheduler.time(intent),
        )
        if (shown) {
            state.fired = state.fired + (taskId to key)
            MarkFiredWorker.enqueue(context, taskId, key)
        }
    }
}
