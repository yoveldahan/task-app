package com.ras.tasks.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.appwidget.CheckBox
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.unit.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.size
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.Spacer
import androidx.glance.layout.width
import androidx.glance.action.actionParametersOf
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.ras.tasks.R
import com.ras.tasks.data.WidgetSnapshot
import com.ras.tasks.data.WidgetSnapshotStore
import com.ras.tasks.domain.OpenTask
import com.ras.tasks.reminders.openTaskIntent
import java.time.LocalDate

class TasksWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = WidgetSnapshotStore.read(context)
        provideContent { WidgetContent(snapshot) }
    }
}

private val RED = ColorProvider(Color(0xFFDC2626))
private val GREY = ColorProvider(Color(0xFF64748B))

@Composable
private fun WidgetContent(snapshot: WidgetSnapshot) {
    val context = LocalContext.current
    Column(
        modifier = GlanceModifier.fillMaxSize().background(ColorProvider(Color.White)).padding(12.dp),
    ) {
        Row(
            modifier = GlanceModifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "המשימות שלי",
                modifier = GlanceModifier.defaultWeight(),
                style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp),
            )
            if (snapshot.refreshing) {
                Text(text = "מרענן…", style = TextStyle(fontSize = 12.sp, color = GREY))
            } else {
                Image(
                    provider = ImageProvider(R.drawable.ic_refresh),
                    contentDescription = "רענון",
                    modifier = GlanceModifier.size(32.dp).padding(4.dp).clickable(actionRunCallback<RefreshAction>()),
                )
            }
        }
        snapshot.status?.let { Text(text = it, style = TextStyle(fontSize = 11.sp, color = GREY)) }
        when {
            !snapshot.signedIn -> Text(
                text = "התחבר באפליקציה",
                modifier = GlanceModifier.clickable(actionStartActivity(loginIntent(context))),
                style = TextStyle(fontSize = 14.sp),
            )
            snapshot.tasks.isEmpty() -> Text(text = "אין משימות פתוחות", style = TextStyle(fontSize = 13.sp, color = GREY))
            else -> {
                Text(
                    text = "${snapshot.tasks.size} משימות פתוחות",
                    style = TextStyle(fontSize = 13.sp, color = GREY),
                )
                LazyColumn {
                    items(snapshot.tasks, itemId = { it.id.hashCode().toLong() }) { task ->
                        TaskRow(task)
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskRow(task: OpenTask) {
    val context = LocalContext.current
    val overdue = task.dueDate?.let { runCatching { LocalDate.parse(it).isBefore(LocalDate.now()) }.getOrDefault(false) } ?: false
    Row(
        modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // First in a Row, so it sits on the right in the widget's RTL layout.
        CheckBox(
            checked = false,
            onCheckedChange = actionRunCallback<CompleteTaskAction>(
                actionParametersOf(CompleteTaskAction.TaskIdKey to task.id),
            ),
        )
        Spacer(GlanceModifier.width(8.dp))
        Column(
            modifier = GlanceModifier.defaultWeight().clickable(actionStartActivity(openTaskIntent(context, task.id))),
        ) {
            Text(
                text = task.description.ifBlank { "ללא תיאור" },
                maxLines = 2,
                style = TextStyle(fontSize = 14.sp),
            )
            task.dueDate?.let { due ->
                Text(
                    text = "עד ${formatDue(due)}",
                    maxLines = 1,
                    style = TextStyle(fontSize = 11.sp, color = if (overdue) RED else GREY),
                )
            }
        }
    }
}

/** 2026-11-02 → 02.11 (the year is left out to keep the row short). */
private fun formatDue(iso: String): String {
    val parts = iso.split("-")
    return if (parts.size == 3) "${parts[2]}.${parts[1]}" else iso
}

private fun loginIntent(context: Context) = com.ras.tasks.MainActivity.loginIntent(context)
