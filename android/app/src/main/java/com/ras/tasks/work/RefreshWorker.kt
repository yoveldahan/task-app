package com.ras.tasks.work

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.ras.tasks.Toasts
import com.ras.tasks.data.ReminderState
import com.ras.tasks.data.Supabase
import com.ras.tasks.data.TasksRepository
import com.ras.tasks.data.WidgetSnapshot
import com.ras.tasks.data.WidgetSnapshotStore
import com.ras.tasks.domain.PendingCompletion
import com.ras.tasks.domain.ReminderDue
import com.ras.tasks.domain.TaskRow
import com.ras.tasks.domain.planReminders
import com.ras.tasks.domain.toOpenTask
import com.ras.tasks.domain.withoutPending
import com.ras.tasks.reminders.ReminderNotifier
import com.ras.tasks.reminders.ReminderScheduler
import com.ras.tasks.widget.TasksWidget
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Refreshes never overlap in this process: the mutex makes a later run wait for the current one.
 * [running] lets the refresh button see that a run is already in progress.
 */
object RefreshGate {
    val mutex = Mutex()
    val running = AtomicBoolean(false)
}

/**
 * Every refresh: sends the widget's pending completions, reads the open tasks, redraws the widget,
 * and plans the reminders (alarms, and reminders that are due now).
 */
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = RefreshGate.mutex.withLock {
        val context = applicationContext
        RefreshGate.running.set(true)
        WidgetSnapshotStore.setRefreshing(context, true)
        TasksWidget().updateAll(context)
        try {
            // A network call that hangs must not hold the lock (and the spinner) forever.
            withTimeoutOrNull(REFRESH_TIMEOUT_MS) { refreshOnce(context) } ?: run {
                WidgetSnapshotStore.setStatus(context, "אין חיבור. מוצגת הרשימה הקודמת.")
                Result.retry()
            }
        } finally {
            WidgetSnapshotStore.setRefreshing(context, false)
            RefreshGate.running.set(false)
            TasksWidget().updateAll(context)
        }
    }

    private suspend fun refreshOnce(context: Context): Result {
        return try {
            val client = Supabase.get(context)
            client.auth.loadFromStorage()
            val repo = TasksRepository(client)
            if (repo.currentUserId() == null) {
                signedOut(context)
                return Result.success()
            }
            val failed = flushPending(context, repo)
            val rows = repo.fetchOpenRows().orEmpty()
            val clientNames = repo.fetchClientNames()
            val pending = WidgetSnapshotStore.readPending(context)
            WidgetSnapshotStore.save(
                context,
                WidgetSnapshot(signedIn = true, tasks = rows.map { it.toOpenTask() }.withoutPending(pending)),
            )
            WidgetSnapshotStore.setStatus(context, null)
            TasksWidget().updateAll(context)
            applyReminders(context, rows, clientNames)
            if (failed) Result.retry() else Result.success()
        } catch (e: Exception) {
            // Keep the list that is already shown; only say that the refresh did not work.
            WidgetSnapshotStore.setStatus(context, "אין חיבור. מוצגת הרשימה הקודמת.")
            Result.retry()
        }
    }

    /** Sends completions the widget made. Returns true if any failed and will be retried. */
    private suspend fun flushPending(context: Context, repo: TasksRepository): Boolean {
        val pending = WidgetSnapshotStore.readPending(context)
        if (pending.isEmpty()) return false
        val nowIso = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString()
        val remaining = mutableListOf<PendingCompletion>()
        var failed = false
        for (item in pending) {
            try {
                repo.completeTask(item.task.id, nowIso)
            } catch (e: Exception) {
                failed = true
                val attempts = item.attempts + 1
                if (attempts < MAX_ATTEMPTS) {
                    remaining += item.copy(attempts = attempts)
                } else {
                    // Give up: dropping it from the queue puts the task back in the list on this refresh.
                    Toasts.show(context, "לא הצלחנו לסמן את \"${item.task.description}\". היא הוחזרה לרשימה.")
                }
            }
        }
        WidgetSnapshotStore.writePending(context, remaining)
        return failed
    }

    private fun applyReminders(context: Context, rows: List<TaskRow>, clientNames: Map<String, String>) {
        val state = ReminderState(context)
        var scheduled = state.scheduled
        var fired = state.fired
        val plan = planReminders(rows, Instant.now(), ZoneId.systemDefault(), scheduled, fired, clientNames)

        for (id in plan.cancel) {
            ReminderScheduler.cancel(context, id)
            scheduled = scheduled - id
        }
        for (r in plan.schedule) {
            ReminderScheduler.schedule(context, r, timeOf(r.key))
            scheduled = scheduled + (r.taskId to r.key)
        }
        for (r in plan.fireNow) {
            // Only mark as fired once the notification is really shown, so a missing permission doesn't lose it.
            if (ReminderNotifier.show(context, r.taskId, r.title, r.body, timeOf(r.key))) {
                fired = fired + (r.taskId to r.key)
                MarkFiredWorker.enqueue(context, r.taskId, r.key)
            }
        }
        val openIds = rows.map { it.id }.toSet()
        state.scheduled = scheduled.filterKeys { it in openIds }
        state.fired = fired.filterKeys { it in openIds }
    }

    private suspend fun signedOut(context: Context) {
        WidgetSnapshotStore.save(context, WidgetSnapshot(signedIn = false, tasks = emptyList()))
        WidgetSnapshotStore.writePending(context, emptyList())
        WidgetSnapshotStore.setStatus(context, null)
        val state = ReminderState(context)
        state.scheduled.keys.forEach { ReminderScheduler.cancel(context, it) }
        state.clearScheduled()
        TasksWidget().updateAll(context)
    }

    private fun timeOf(key: String): String = key.substringAfter(' ')

    private companion object {
        const val MAX_ATTEMPTS = 3
        const val REFRESH_TIMEOUT_MS = 60_000L
    }
}
