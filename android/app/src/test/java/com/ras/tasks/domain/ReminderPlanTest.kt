package com.ras.tasks.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class ReminderPlanTest {
    private val zone = ZoneId.of("Asia/Jerusalem")
    private val now = Instant.parse("2026-11-01T10:00:00Z") // 12:00 in Jerusalem

    private fun row(
        id: String,
        date: String? = "2026-11-01",
        time: String? = "13:00",
        fired: String? = null,
        done: Boolean = false,
        deleted: String? = null,
    ) = TaskRow(
        id = id,
        user_id = "u",
        description = " משימה $id ",
        done = done,
        created_at = "2026-10-01T00:00:00Z",
        deleted_at = deleted,
        reminder_date = date,
        reminder_time = time,
        reminder_fired_for = fired,
    )

    @Test
    fun futureReminderIsScheduledWithSiteKeyAndLocalTime() {
        val plan = planReminders(listOf(row("a")), now, zone, scheduled = emptyMap(), firedLocally = emptyMap())
        assertEquals(listOf("a"), plan.schedule.map { it.taskId })
        assertEquals("2026-11-01 13:00", plan.schedule.single().key)
        assertEquals(Instant.parse("2026-11-01T11:00:00Z"), plan.schedule.single().dueAt)
        assertTrue(plan.fireNow.isEmpty())
    }

    @Test
    fun reminderThatPassedWhileOffFiresOnceAtOnce() {
        val plan = planReminders(listOf(row("a", time = "09:00")), now, zone, emptyMap(), emptyMap())
        assertEquals(listOf("a"), plan.fireNow.map { it.taskId })
        assertTrue(plan.schedule.isEmpty())
    }

    @Test
    fun alreadyFiredOnServerOrLocallyIsNotFiredAgain() {
        val serverFired = row("a", time = "09:00", fired = "2026-11-01 09:00")
        val localFired = row("b", time = "09:00")
        val plan = planReminders(listOf(serverFired, localFired), now, zone, emptyMap(), mapOf("b" to "2026-11-01 09:00"))
        assertTrue(plan.fireNow.isEmpty())
        assertTrue(plan.schedule.isEmpty())
    }

    @Test
    fun doneDeletedOrNoReminderTasksAreIgnoredAndTheirAlarmsCancelled() {
        val rows = listOf(row("done", done = true), row("gone", deleted = "x"), row("none", date = null))
        val plan = planReminders(rows, now, zone, scheduled = mapOf("done" to "2026-11-01 13:00", "gone" to "2026-11-01 13:00"), firedLocally = emptyMap())
        assertTrue(plan.schedule.isEmpty())
        assertTrue(plan.fireNow.isEmpty())
        assertEquals(setOf("done", "gone"), plan.cancel.toSet())
    }

    @Test
    fun changedTimeReschedulesAndCancelsNothingExtra() {
        val changed = row("a", time = "14:00")
        val plan = planReminders(listOf(changed), now, zone, scheduled = mapOf("a" to "2026-11-01 13:00"), firedLocally = emptyMap())
        assertEquals(listOf("2026-11-01 14:00"), plan.schedule.map { it.key })
        assertEquals(listOf("a"), plan.cancel)
    }

    @Test
    fun alreadyScheduledSameKeyIsLeftAlone() {
        val plan = planReminders(listOf(row("a")), now, zone, scheduled = mapOf("a" to "2026-11-01 13:00"), firedLocally = emptyMap())
        assertTrue(plan.schedule.isEmpty())
        assertTrue(plan.cancel.isEmpty())
    }

    @Test
    fun titleUsesTheClientNameAndBodyIsTheTaskText() {
        val withClient = row("a").copy(client_id = "c1")
        val plan = planReminders(listOf(withClient), now, zone, emptyMap(), emptyMap(), mapOf("c1" to "פז"))
        val due = plan.schedule.single()
        assertEquals("⏰ תזכורת: פז", due.title)
        assertEquals("משימה a", due.body)
    }

    @Test
    fun titleWithoutClientIsPlainReminder() {
        val plan = planReminders(listOf(row("a")), now, zone, emptyMap(), emptyMap())
        assertEquals("⏰ תזכורת", plan.schedule.single().title)
    }
}
