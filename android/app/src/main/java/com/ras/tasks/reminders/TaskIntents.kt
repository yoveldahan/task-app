package com.ras.tasks.reminders

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.ras.tasks.MainActivity

/** Opens the app on one task. Each task gets its own data URI so PendingIntents don't collide. */
fun openTaskIntent(context: Context, taskId: String): Intent =
    Intent(context, MainActivity::class.java).apply {
        action = MainActivity.ACTION_OPEN_TASK
        data = Uri.parse("ras-task://${Uri.encode(taskId)}")
    }
