package com.ras.tasks.data

import com.ras.tasks.domain.TaskRow
import com.ras.tasks.domain.openRowsFor
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import kotlinx.serialization.Serializable

/** Writes only the columns the website writes for the same change. */
@Serializable
private data class CompletePatch(
    val done: Boolean = true,
    val completed_at: String,
    val updated_at: String,
)

@Serializable
private data class ClientName(val id: String, val name: String)

@Serializable
private data class ReminderFiredPatch(
    val reminder_fired_for: String,
    val updated_at: String,
)

class TasksRepository(private val client: SupabaseClient) {

    /** Id of the signed-in user, or null when nobody is signed in. */
    suspend fun currentUserId(): String? = client.auth.currentSessionOrNull()?.user?.id

    /** Open tasks of the signed-in user (with reminder fields), or null when nobody is signed in. */
    suspend fun fetchOpenRows(): List<TaskRow>? {
        val userId = currentUserId() ?: return null
        val rows = client.from("tasks")
            .select(
                Columns.list(
                    "id", "user_id", "description", "done", "due_date", "created_at", "deleted_at", "client_id",
                    "reminder_date", "reminder_time", "reminder_fired_for",
                ),
            ) {
                filter {
                    eq("user_id", userId)
                    eq("done", false)
                    filter("deleted_at", FilterOperator.IS, "null")
                }
                order("due_date", Order.ASCENDING)
                order("created_at", Order.ASCENDING)
            }
            .decodeList<TaskRow>()
        return rows.openRowsFor(userId)
    }

    /** Client id to name, for reminder titles (live clients only). */
    suspend fun fetchClientNames(): Map<String, String> {
        val userId = currentUserId() ?: return emptyMap()
        return client.from("clients")
            .select(Columns.list("id", "name")) {
                filter {
                    eq("user_id", userId)
                    filter("deleted_at", FilterOperator.IS, "null")
                }
            }
            .decodeList<ClientName>()
            .associate { it.id to it.name }
    }

    /**
     * Marks the task done the way the website does (done, completed_at, updated_at).
     * Only open tasks are changed, so a task already completed elsewhere keeps its original time.
     */
    suspend fun completeTask(taskId: String, nowIso: String) {
        val userId = currentUserId() ?: throw IllegalStateException("not signed in")
        client.from("tasks").update(CompletePatch(completed_at = nowIso, updated_at = nowIso)) {
            filter {
                eq("id", taskId)
                eq("user_id", userId)
                eq("done", false)
            }
        }
    }

    /** Sets reminder_fired_for, the same field the website sets when it shows a reminder. */
    suspend fun markReminderFired(taskId: String, key: String, nowIso: String) {
        val userId = currentUserId() ?: throw IllegalStateException("not signed in")
        client.from("tasks").update(ReminderFiredPatch(reminder_fired_for = key, updated_at = nowIso)) {
            filter {
                eq("id", taskId)
                eq("user_id", userId)
            }
        }
    }
}
