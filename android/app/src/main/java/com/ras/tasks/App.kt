package com.ras.tasks

import android.app.Application
import com.ras.tasks.reminders.ReminderNotifier

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        ReminderNotifier.createChannel(this)
    }
}
