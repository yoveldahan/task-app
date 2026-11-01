package com.ras.tasks.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.updateAll
import com.ras.tasks.data.WidgetSnapshotStore
import com.ras.tasks.work.RefreshGate
import com.ras.tasks.work.RefreshScheduler

/** Refresh button: shows the loading state at once and runs the same refresh as the periodic worker. */
class RefreshAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        // A run is already in progress: don't queue another one.
        if (RefreshGate.running.get()) return
        WidgetSnapshotStore.setRefreshing(context, true)
        TasksWidget().updateAll(context)
        RefreshScheduler.refreshManual(context)
    }
}
