package com.ras.tasks.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class CompletionTest {
    private fun task(id: String, due: String?) = OpenTask(id = id, description = id, dueDate = due)

    @Test
    fun pendingCompletionsAreHiddenFromTheList() {
        val open = listOf(task("a", "2026-11-02"), task("b", null))
        val pending = listOf(PendingCompletion(task("a", "2026-11-02")))
        assertEquals(listOf("b"), open.withoutPending(pending).map { it.id })
    }

    @Test
    fun restoredTaskGoesBackInDueDateOrderWithUndatedLast() {
        val open = listOf(task("a", "2026-11-02"), task("c", "2026-11-09"), task("u", null))
        val restored = open.withRestored(task("b", "2026-11-05"))
        assertEquals(listOf("a", "b", "c", "u"), restored.map { it.id })
    }
}
