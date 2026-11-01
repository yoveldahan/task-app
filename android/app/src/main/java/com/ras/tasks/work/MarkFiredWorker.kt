package com.ras.tasks.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.ras.tasks.data.Supabase
import com.ras.tasks.data.TasksRepository
import io.github.jan.supabase.auth.auth
import java.time.Instant
import java.util.concurrent.TimeUnit

/** Writes reminder_fired_for after a reminder was shown, retrying until Supabase accepts it. */
class MarkFiredWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val taskId = inputData.getString(KEY_TASK) ?: return Result.failure()
        val key = inputData.getString(KEY_REMINDER) ?: return Result.failure()
        return try {
            val client = Supabase.get(applicationContext)
            client.auth.loadFromStorage()
            TasksRepository(client).markReminderFired(taskId, key, Instant.now().toString())
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val KEY_TASK = "task_id"
        private const val KEY_REMINDER = "reminder_key"

        fun enqueue(context: Context, taskId: String, key: String) {
            val request = OneTimeWorkRequestBuilder<MarkFiredWorker>()
                .setInputData(Data.Builder().putString(KEY_TASK, taskId).putString(KEY_REMINDER, key).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("mark-fired-$taskId", ExistingWorkPolicy.REPLACE, request)
        }
    }
}
