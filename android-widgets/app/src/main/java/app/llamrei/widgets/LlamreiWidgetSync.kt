package app.llamrei.widgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Dual-path sync client (LAN primary -> Tailscale Serve HTTPS fallback) with
 * thread-safe Offline Cache + Idempotent Outbox Queue (FR-63..68).
 */
object LlamreiWidgetSync {
    private const val PREFS = "llamrei_widget_prefs"
    private const val KEY_LAN_URL = "lan_url"
    private const val KEY_TAILSCALE_URL = "tailscale_url"
    private const val KEY_BEARER_TOKEN = "bearer_token"
    private const val KEY_SNAPSHOT = "cached_snapshot"
    private const val KEY_KNOWN_ALARM_IDS = "known_alarm_ids"
    private const val KEY_OUTBOX = "offline_outbox"
    private val WIB_ZONE: ZoneId = ZoneId.of("Asia/Jakarta")
    private val WIB_HM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm").withZone(WIB_ZONE)

    @Synchronized
    fun configureEndpoints(ctx: Context, lanUrl: String, tailscaleUrl: String, token: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAN_URL, lanUrl.trim().trimEnd('/'))
            .putString(KEY_TAILSCALE_URL, tailscaleUrl.trim().trimEnd('/'))
            .putString(KEY_BEARER_TOKEN, token.trim())
            .apply()
    }

    fun getEndpoints(ctx: Context): Triple<String, String, String> {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val lan = prefs.getString(KEY_LAN_URL, "http://192.168.100.151:5173") ?: "http://192.168.100.151:5173"
        val ts = prefs.getString(KEY_TAILSCALE_URL, "http://100.114.87.2:5173") ?: "http://100.114.87.2:5173"
        val tok = prefs.getString(KEY_BEARER_TOKEN, "") ?: ""
        return Triple(lan, ts, tok)
    }

    fun formatIsoToWibHm(iso: String?): String {
        if (iso.isNullOrBlank()) return "--:--"
        return runCatching { WIB_HM.format(OffsetDateTime.parse(iso).toInstant()) }.getOrDefault("--:--")
    }

    @Synchronized
    fun getCachedSnapshot(ctx: Context): JSONObject? {
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SNAPSHOT, null)
        return raw?.let { runCatching { JSONObject(it) }.getOrNull() }
    }

    @Synchronized
    fun enqueueOfflineMutation(
        ctx: Context,
        actionType: String,
        targetId: String,
        payload: JSONObject = JSONObject(),
    ) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = runCatching { JSONArray(prefs.getString(KEY_OUTBOX, "[]")) }.getOrDefault(JSONArray())
        val item = JSONObject()
            .put("mutationId", "and_${UUID.randomUUID().toString().take(10)}")
            .put("deviceId", Build.MODEL ?: "android_widget")
            .put("actionType", actionType)
            .put("targetId", targetId)
            .put("payload", payload)
            .put("clientTimestamp", Instant.now().toString())
        arr.put(item)
        prefs.edit().putString(KEY_OUTBOX, arr.toString()).apply()
    }

    private fun readOutboxSnapshotIds(ctx: Context): Pair<JSONArray, Set<String>> {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = runCatching { JSONArray(prefs.getString(KEY_OUTBOX, "[]")) }.getOrDefault(JSONArray())
        val ids = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            arr.optJSONObject(i)?.optString("mutationId")?.let { ids.add(it) }
        }
        return arr to ids
    }

    @Synchronized
    private fun removeAckedOutboxMutations(ctx: Context, ackedIds: Set<String>) {
        if (ackedIds.isEmpty()) return
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = runCatching { JSONArray(prefs.getString(KEY_OUTBOX, "[]")) }.getOrDefault(JSONArray())
        val remaining = JSONArray()
        for (i in 0 until current.length()) {
            val obj = current.optJSONObject(i) ?: continue
            if (obj.optString("mutationId") !in ackedIds) {
                remaining.put(obj)
            }
        }
        prefs.edit().putString(KEY_OUTBOX, remaining.toString()).apply()
    }

    private fun httpJson(url: String, method: String, token: String, body: String? = null): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 2500
            readTimeout = 4000
            if (token.isNotBlank()) {
                setRequestProperty("Authorization", "Bearer $token")
            }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        if (body != null) {
            conn.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = conn.responseCode
        if (code !in 200..299) {
            throw IllegalStateException("HTTP $code from $url")
        }
        return JSONObject(conn.inputStream.bufferedReader().readText())
    }

    fun syncWithServer(ctx: Context): JSONObject? {
        val (lanUrl, tsUrl, token) = getEndpoints(ctx)
        val candidateUrls = listOf(lanUrl, tsUrl).filter { it.isNotBlank() }
        val (outbox, sentIds) = readOutboxSnapshotIds(ctx)

        for (baseUrl in candidateUrls) {
            val result = runCatching {
                val snapshot: JSONObject = if (outbox.length() > 0) {
                    val reqBody = JSONObject().put("mutations", outbox).toString()
                    val res = httpJson("$baseUrl/api/mobile-widget/reconcile", "POST", token, reqBody)
                    removeAckedOutboxMutations(ctx, sentIds)
                    res.getJSONObject("snapshot")
                } else {
                    httpJson("$baseUrl/api/mobile-widget/snapshot", "GET", token)
                }

                synchronized(this) {
                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_SNAPSHOT, snapshot.toString())
                        .apply()
                }
                scheduleExactAlarmsFromSnapshot(ctx, snapshot)
                snapshot
            }.getOrNull()

            if (result != null) return result
        }
        return getCachedSnapshot(ctx)
    }

    fun scheduleExactAlarmsFromSnapshot(ctx: Context, snapshot: JSONObject) {
        val alarmMgr = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val prevKnown = prefs.getStringSet(KEY_KNOWN_ALARM_IDS, emptySet()) ?: emptySet()
        val nextKnown = mutableSetOf<String>()
        val alarms = snapshot.optJSONArray("alarms") ?: JSONArray()

        for (i in 0 until alarms.length()) {
            val alm = alarms.getJSONObject(i)
            val id = alm.getString("id")
            nextKnown.add(id)

            val intent = Intent(ctx, ExactAlarmReceiver::class.java).apply {
                putExtra("alarm_id", id)
                putExtra("alarm_title", alm.optString("title", "Llamrei Alarm"))
            }
            val pi = PendingIntent.getBroadcast(
                ctx,
                id.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            val enabled = alm.optInt("enabled", 0) == 1
            val status = alm.optString("status")
            if (!enabled || (status != "armed" && status != "snoozed")) {
                alarmMgr.cancel(pi)
                continue
            }

            val triggerIso = if (!alm.isNull("snoozed_until") && alm.optString("snoozed_until").isNotBlank()) {
                alm.getString("snoozed_until")
            } else {
                alm.getString("trigger_at")
            }
            val triggerMs = runCatching { OffsetDateTime.parse(triggerIso).toInstant().toEpochMilli() }.getOrNull() ?: continue
            if (triggerMs <= System.currentTimeMillis()) continue

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmMgr.canScheduleExactAlarms()) {
                alarmMgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
            } else {
                val showIntent = PendingIntent.getActivity(
                    ctx,
                    0,
                    Intent(ctx, AlarmRingingActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE,
                )
                alarmMgr.setAlarmClock(AlarmManager.AlarmClockInfo(triggerMs, showIntent), pi)
            }
        }

        // Cancel any previously armed alarm that was deleted on the server
        for (oldId in prevKnown - nextKnown) {
            val pi = PendingIntent.getBroadcast(
                ctx,
                oldId.hashCode(),
                Intent(ctx, ExactAlarmReceiver::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )
            if (pi != null) alarmMgr.cancel(pi)
        }
        prefs.edit().putStringSet(KEY_KNOWN_ALARM_IDS, nextKnown).apply()
    }
}
