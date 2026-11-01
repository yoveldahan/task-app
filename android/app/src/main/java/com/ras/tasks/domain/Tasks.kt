package com.ras.tasks.domain

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** One row of public.tasks, limited to the columns the app reads. */
@Serializable
data class TaskRow(
    val id: String,
    val user_id: String,
    val description: String = "",
    val done: Boolean = false,
    val due_date: String? = null,
    val created_at: String = "",
    val deleted_at: String? = null,
    val client_id: String? = null,
    val reminder_date: String? = null,
    val reminder_time: String? = null,
    val reminder_fired_for: String? = null,
)

/** A task as the widget shows it. */
@Serializable
data class OpenTask(
    val id: String,
    val description: String,
    val dueDate: String?,
)

/** A completion the widget made that Supabase has not accepted yet. */
@Serializable
data class PendingCompletion(
    val task: OpenTask,
    val attempts: Int = 0,
)

/** Open tasks of [userId]: not done and not soft-deleted, sorted by due date (undated last), then creation time. */
fun List<TaskRow>.openRowsFor(userId: String): List<TaskRow> =
    filter { it.user_id == userId && !it.done && it.deleted_at == null }
        .sortedWith(compareBy<TaskRow, String?>(nullsLast()) { it.due_date }.thenBy { it.created_at })

fun TaskRow.toOpenTask(): OpenTask = OpenTask(id = id, description = description.trim(), dueDate = due_date)

fun List<TaskRow>.openTasksFor(userId: String): List<OpenTask> = openRowsFor(userId).map { it.toOpenTask() }

/** Removes tasks whose completion is still waiting to reach Supabase. */
fun List<OpenTask>.withoutPending(pending: List<PendingCompletion>): List<OpenTask> {
    val ids = pending.map { it.task.id }.toSet()
    return filter { it.id !in ids }
}

/** Puts a task back into the list in due-date order (undated last). */
fun List<OpenTask>.withRestored(task: OpenTask): List<OpenTask> =
    (this + task).sortedWith(compareBy<OpenTask, String?>(nullsLast()) { it.dueDate })

/** The site's reminder key, "YYYY-MM-DD HH:MM". A reminder has fired when reminder_fired_for equals it. */
fun reminderKey(date: String, time: String): String = "$date $time"

/** The reminder moment in the device's time zone, which is what the site uses too. */
fun TaskRow.reminderDueAt(zone: ZoneId): Instant? {
    val date = reminder_date?.takeIf { it.isNotBlank() } ?: return null
    val time = reminder_time?.takeIf { it.isNotBlank() } ?: return null
    return LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(zone).toInstant()
}

fun TaskRow.reminderKeyOrNull(): String? {
    val date = reminder_date?.takeIf { it.isNotBlank() } ?: return null
    val time = reminder_time?.takeIf { it.isNotBlank() } ?: return null
    return reminderKey(date, time)
}

/** A reminder to show. Title and body match the website: "⏰ תזכורת: <client>" and the task text. */
data class ReminderDue(val taskId: String, val title: String, val body: String, val key: String, val dueAt: Instant)

/**
 * What the reminder loop should do now.
 * - [fireNow]: due and not fired yet (includes reminders that passed while the phone was off).
 * - [schedule]: future reminders that need an alarm, or whose time changed.
 * - [cancel]: task ids with an alarm that must go (completed, deleted, moved, or already due).
 */
data class ReminderPlan(
    val fireNow: List<ReminderDue>,
    val schedule: List<ReminderDue>,
    val cancel: List<String>,
)

/**
 * Plans the reminders for [rows] (already filtered to open tasks of the user).
 * [scheduled] maps task id to the key of the alarm already set; [firedLocally] maps task id to the key already shown here.
 * [clientNames] maps client id to the client's name, for the title.
 */
fun planReminders(
    rows: List<TaskRow>,
    now: Instant,
    zone: ZoneId,
    scheduled: Map<String, String>,
    firedLocally: Map<String, String>,
    clientNames: Map<String, String> = emptyMap(),
): ReminderPlan {
    val candidates = rows.mapNotNull { row ->
        if (row.done || row.deleted_at != null) return@mapNotNull null
        val key = row.reminderKeyOrNull() ?: return@mapNotNull null
        if (row.reminder_fired_for == key || firedLocally[row.id] == key) return@mapNotNull null
        val due = row.reminderDueAt(zone) ?: return@mapNotNull null
        val clientName = row.client_id?.let { clientNames[it] }
        val title = if (clientName.isNullOrBlank()) "⏰ תזכורת" else "⏰ תזכורת: $clientName"
        ReminderDue(row.id, title, row.description.trim().ifBlank { "משימה" }, key, due)
    }
    val fireNow = candidates.filter { !it.dueAt.isAfter(now) }
    val future = candidates.filter { it.dueAt.isAfter(now) }
    val schedule = future.filter { scheduled[it.taskId] != it.key }
    val keep = future.filter { scheduled[it.taskId] == it.key }.map { it.taskId }.toSet()
    val cancel = scheduled.keys.filter { it !in keep }
    return ReminderPlan(fireNow = fireNow, schedule = schedule, cancel = cancel)
}
