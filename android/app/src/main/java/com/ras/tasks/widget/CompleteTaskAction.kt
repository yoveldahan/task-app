package com.ras.tasks.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.action.ActionParameters.Key
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.updateAll
import com.ras.tasks.data.ReminderState
import com.ras.tasks.data.WidgetSnapshotStore
import com.ras.tasks.domain.PendingCompletion
import com.ras.tasks.AppState
import com.ras.tasks.reminders.ReminderScheduler
import com.ras.tasks.work.RefreshScheduler


/**
 * Checkbox tapped: the task leaves the widget at once, and the completion is queued for Supabase.
 * The refresh worker sends it (with retries) and gives the task back if it never goes through.
 */
class CompleteTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val id = parameters[TaskIdKey] ?: return
        val snapshot = WidgetSnapshotStore.read(context)
        val task = snapshot.tasks.firstOrNull { it.id == id } ?: return

        val pending = WidgetSnapshotStore.readPending(context)
        if (pending.none { it.task.id == id }) {
            WidgetSnapshotStore.writePending(context, pending + PendingCompletion(task))
        }
        WidgetSnapshotStore.save(context, snapshot.copy(tasks = snapshot.tasks.filterNot { it.id == id }))

        ReminderScheduler.cancel(context, id)
        val state = ReminderState(context)
        state.scheduled = state.scheduled - id

        AppState.markChangedFromWidget(context)
        TasksWidget().updateAll(context)
        RefreshScheduler.refreshNow(context)
    }

    companion object {
        val TaskIdKey = Key<String>("task_id")
    }
}
