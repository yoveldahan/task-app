package com.ras.tasks.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class TasksTest {
    private val me = "user-1"

    private fun row(id: String, user: String = me, done: Boolean = false, due: String? = null, created: String, deleted: String? = null) =
        TaskRow(id = id, user_id = user, description = " $id ", done = done, due_date = due, created_at = created, deleted_at = deleted)

    @Test
    fun keepsOnlyOpenTasksOfTheUser() {
        val rows = listOf(
            row("open", created = "2026-10-01T00:00:00Z"),
            row("done", done = true, created = "2026-10-01T00:00:00Z"),
            row("other", user = "user-2", created = "2026-10-01T00:00:00Z"),
            row("deleted", deleted = "2026-10-02T00:00:00Z", created = "2026-10-01T00:00:00Z"),
        )
        assertEquals(listOf("open"), rows.openTasksFor(me).map { it.id })
    }

    @Test
    fun sortsByDueDateThenCreatedAndPutsUndatedLast() {
        val rows = listOf(
            row("undated-old", due = null, created = "2026-10-01T00:00:00Z"),
            row("late", due = "2026-11-10", created = "2026-10-05T00:00:00Z"),
            row("early-b", due = "2026-11-02", created = "2026-10-09T00:00:00Z"),
            row("early-a", due = "2026-11-02", created = "2026-10-03T00:00:00Z"),
        )
        assertEquals(listOf("early-a", "early-b", "late", "undated-old"), rows.openTasksFor(me).map { it.id })
    }

    @Test
    fun mapsDescriptionTrimmedAndDueDate() {
        val result = listOf(row("t1", due = "2026-11-02", created = "2026-10-01T00:00:00Z")).openTasksFor(me)
        assertEquals(OpenTask(id = "t1", description = "t1", dueDate = "2026-11-02"), result.single())
    }
}
