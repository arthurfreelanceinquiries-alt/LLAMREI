package app.llamrei.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import kotlin.concurrent.thread

const val ACTION_SYNC = "app.llamrei.widgets.ACTION_SYNC"
const val ACTION_TOGGLE_TASK = "app.llamrei.widgets.ACTION_TOGGLE_TASK"
const val ACTION_DISMISS_ALARM = "app.llamrei.widgets.ACTION_DISMISS_ALARM"
const val ACTION_SNOOZE_ALARM = "app.llamrei.widgets.ACTION_SNOOZE_ALARM"

internal fun buildActionPendingIntent(ctx: Context, reqCode: Int, action: String, targetId: String? = null, done: Boolean = true): PendingIntent {
    val intent = Intent(ctx, WidgetActionReceiver::class.java).apply {
        this.action = action
        if (targetId != null) putExtra("target_id", targetId)
        putExtra("done", done)
    }
    return PendingIntent.getBroadcast(ctx, reqCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}

internal fun refreshAllWidgetProviders(ctx: Context, snapshot: JSONObject?) {
    val mgr = AppWidgetManager.getInstance(ctx)
    mgr.getAppWidgetIds(ComponentName(ctx, AllInOneLlamreiWidgetProvider::class.java))
        .forEach { AllInOneLlamreiWidgetProvider.render(ctx, mgr, it, snapshot) }
    mgr.getAppWidgetIds(ComponentName(ctx, TaskWidgetProvider::class.java))
        .forEach { TaskWidgetProvider.render(ctx, mgr, it, snapshot) }
    mgr.getAppWidgetIds(ComponentName(ctx, AlarmWidgetProvider::class.java))
        .forEach { AlarmWidgetProvider.render(ctx, mgr, it, snapshot) }
    mgr.getAppWidgetIds(ComponentName(ctx, ReminderWidgetProvider::class.java))
        .forEach { ReminderWidgetProvider.render(ctx, mgr, it, snapshot) }
}

/**
 * Non-exported internal BroadcastReceiver handling mutating actions from all 4 widgets with goAsync().
 */
class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pendingResult = goAsync()
        thread {
            try {
                when (intent.action) {
                    ACTION_TOGGLE_TASK -> {
                        val tid = intent.getStringExtra("target_id") ?: return@thread
                        val done = intent.getBooleanExtra("done", true)
                        LlamreiWidgetSync.enqueueOfflineMutation(context, "task_toggle_done", tid, JSONObject().put("done", done))
                    }
                    ACTION_DISMISS_ALARM -> {
                        val aid = intent.getStringExtra("target_id") ?: return@thread
                        LlamreiWidgetSync.enqueueOfflineMutation(context, "alarm_dismiss", aid)
                    }
                    ACTION_SNOOZE_ALARM -> {
                        val aid = intent.getStringExtra("target_id") ?: return@thread
                        LlamreiWidgetSync.enqueueOfflineMutation(context, "alarm_snooze", aid, JSONObject().put("minutes", 10))
                    }
                }
                val snap = LlamreiWidgetSync.syncWithServer(context)
                refreshAllWidgetProviders(context, snap)
            } finally {
                pendingResult.finish()
            }
        }
    }
}

class AllInOneLlamreiWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pendingResult = goAsync()
        thread {
            try {
                val snapshot = LlamreiWidgetSync.syncWithServer(context)
                for (id in appWidgetIds) render(context, appWidgetManager, id, snapshot)
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        fun render(ctx: Context, mgr: AppWidgetManager, widgetId: Int, snapshot: JSONObject?) {
            val views = RemoteViews(ctx.packageName, R.layout.widget_all_in_one)
            val nextAlarm = snapshot?.optJSONObject("nextAlarm")
            val tasks = snapshot?.optJSONArray("tasks")
            val reminders = snapshot?.optJSONArray("reminders")

            val alarmTime = nextAlarm?.let {
                val iso = if (!it.isNull("snoozed_until") && it.optString("snoozed_until").isNotBlank()) it.optString("snoozed_until") else it.optString("trigger_at")
                LlamreiWidgetSync.formatIsoToWibHm(iso)
            }
            views.setTextViewText(
                R.id.tv_next_alarm,
                nextAlarm?.let { "⏰ ${it.optString("title")} ($alarmTime WIB)" } ?: "⏰ No Hard Alarm",
            )

            val firstTask = tasks?.optJSONObject(0)
            val secondTask = tasks?.optJSONObject(1)
            views.setTextViewText(R.id.tv_task_1, firstTask?.let { "[${it.optString("status")}] ${it.optString("title")}" } ?: "Semua tugas selesai")
            views.setTextViewText(R.id.tv_task_2, secondTask?.let { "[${it.optString("status")}] ${it.optString("title")}" } ?: "")

            val firstReminder = reminders?.optJSONObject(0)
            views.setTextViewText(R.id.tv_reminder_1, firstReminder?.optString("title") ?: "Tidak ada pengingat terdekat")

            if (firstTask != null) {
                views.setOnClickPendingIntent(
                    R.id.tv_task_1,
                    buildActionPendingIntent(ctx, 101, ACTION_TOGGLE_TASK, firstTask.getString("id"), firstTask.optString("status") != "Done"),
                )
            }
            if (nextAlarm != null) {
                views.setOnClickPendingIntent(R.id.btn_snooze, buildActionPendingIntent(ctx, 102, ACTION_SNOOZE_ALARM, nextAlarm.getString("id")))
                views.setOnClickPendingIntent(R.id.btn_dismiss, buildActionPendingIntent(ctx, 103, ACTION_DISMISS_ALARM, nextAlarm.getString("id")))
            }
            mgr.updateAppWidget(widgetId, views)
        }
    }
}

class TaskWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pendingResult = goAsync()
        thread {
            try {
                val snap = LlamreiWidgetSync.syncWithServer(context)
                for (id in appWidgetIds) render(context, appWidgetManager, id, snap)
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        fun render(ctx: Context, mgr: AppWidgetManager, id: Int, snap: JSONObject?) {
            val tasks = snap?.optJSONArray("tasks")
            val views = RemoteViews(ctx.packageName, R.layout.widget_task_only)
            val t0 = tasks?.optJSONObject(0)
            val t1 = tasks?.optJSONObject(1)
            views.setTextViewText(R.id.tv_task_only_1, t0?.let { "[${it.optString("status")}] ${it.optString("title")}" } ?: "Tidak ada tugas")
            views.setTextViewText(R.id.tv_task_only_2, t1?.let { "[${it.optString("status")}] ${it.optString("title")}" } ?: "")
            if (t0 != null) {
                views.setOnClickPendingIntent(R.id.tv_task_only_1, buildActionPendingIntent(ctx, 201, ACTION_TOGGLE_TASK, t0.getString("id"), t0.optString("status") != "Done"))
            }
            if (t1 != null) {
                views.setOnClickPendingIntent(R.id.tv_task_only_2, buildActionPendingIntent(ctx, 202, ACTION_TOGGLE_TASK, t1.getString("id"), t1.optString("status") != "Done"))
            }
            mgr.updateAppWidget(id, views)
        }
    }
}

class AlarmWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pendingResult = goAsync()
        thread {
            try {
                val snap = LlamreiWidgetSync.syncWithServer(context)
                for (id in appWidgetIds) render(context, appWidgetManager, id, snap)
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        fun render(ctx: Context, mgr: AppWidgetManager, id: Int, snap: JSONObject?) {
            val next = snap?.optJSONObject("nextAlarm")
            val views = RemoteViews(ctx.packageName, R.layout.widget_alarm_only)
            val timeStr = next?.let {
                val iso = if (!it.isNull("snoozed_until") && it.optString("snoozed_until").isNotBlank()) it.optString("snoozed_until") else it.optString("trigger_at")
                LlamreiWidgetSync.formatIsoToWibHm(iso)
            }
            views.setTextViewText(R.id.tv_alarm_only_title, next?.let { "${it.optString("title")}\n$timeStr WIB (Ketuk Snooze 10m)" } ?: "No Armed Alarm")
            if (next != null) {
                views.setOnClickPendingIntent(R.id.tv_alarm_only_title, buildActionPendingIntent(ctx, 301, ACTION_SNOOZE_ALARM, next.getString("id")))
            }
            mgr.updateAppWidget(id, views)
        }
    }
}

class ReminderWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pendingResult = goAsync()
        thread {
            try {
                val snap = LlamreiWidgetSync.syncWithServer(context)
                for (id in appWidgetIds) render(context, appWidgetManager, id, snap)
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        fun render(ctx: Context, mgr: AppWidgetManager, id: Int, snap: JSONObject?) {
            val rems = snap?.optJSONArray("reminders")
            val views = RemoteViews(ctx.packageName, R.layout.widget_reminder_only)
            val r0 = rems?.optJSONObject(0)
            views.setTextViewText(R.id.tv_rem_only_1, r0?.let { "${it.optString("title")} (${LlamreiWidgetSync.formatIsoToWibHm(it.optString("trigger_at"))} WIB)" } ?: "Belum ada pengingat")
            views.setOnClickPendingIntent(R.id.tv_rem_only_1, buildActionPendingIntent(ctx, 401, ACTION_SYNC))
            mgr.updateAppWidget(id, views)
        }
    }
}
