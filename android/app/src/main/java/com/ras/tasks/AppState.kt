package com.ras.tasks

import android.content.Context

/** Small flags shared between the widget and the activity. */
object AppState {
    private const val PREFS = "app"
    private const val KEY_WIDGET_CHANGED = "widget_changed"

    /** Set when the widget changed a task, so the website reloads its data when the app comes back. */
    fun markChangedFromWidget(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_WIDGET_CHANGED, true).apply()
    }

    /** Returns true once after a widget change. */
    fun consumeWidgetChange(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val changed = prefs.getBoolean(KEY_WIDGET_CHANGED, false)
        if (changed) prefs.edit().putBoolean(KEY_WIDGET_CHANGED, false).apply()
        return changed
    }
}
