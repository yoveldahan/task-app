package com.ras.tasks.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.ras.tasks.data.ReminderState
import com.ras.tasks.work.RefreshScheduler

/** After a reboot all alarms are gone: forget them and run a refresh, which sets them again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        ReminderState(context).clearScheduled()
        RefreshScheduler.schedulePeriodic(context)
        RefreshScheduler.refreshNow(context)
    }
}
