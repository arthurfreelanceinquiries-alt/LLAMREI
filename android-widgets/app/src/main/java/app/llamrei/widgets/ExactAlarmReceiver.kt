package app.llamrei.widgets

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Fires exact alarms via a high-priority Notification + setFullScreenIntent (compliant with
 * Android 10+ Background Activity Launch restrictions).
 */
class ExactAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            LlamreiWidgetSync.getCachedSnapshot(context)?.let {
                LlamreiWidgetSync.scheduleExactAlarmsFromSnapshot(context, it)
            }
            return
        }
        val alarmId = intent.getStringExtra("alarm_id") ?: return
        val title = intent.getStringExtra("alarm_title") ?: "Llamrei Hard Alarm"
        val channelId = "llamrei_hard_alarms"
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(channelId, "Llamrei Hard Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(true)
            }
            nm.createNotificationChannel(ch)
        }

        val ringIntent = Intent(context, AlarmRingingActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("alarm_id", alarmId)
            putExtra("alarm_title", title)
        }
        val fullScreenPi = PendingIntent.getActivity(
            context,
            alarmId.hashCode(),
            ringIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.Notification.Builder(context, channelId)
        } else {
            @Suppress("DEPRECATION")
            android.app.Notification.Builder(context)
        }
        val notif = builder
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("⏰ HARD ALARM LLAMREI")
            .setContentText(title)
            .setCategory(android.app.Notification.CATEGORY_ALARM)
            .setFullScreenIntent(fullScreenPi, true)
            .setAutoCancel(true)
            .build()

        nm.notify(alarmId.hashCode(), notif)
    }
}

class AlarmRingingActivity : Activity() {
    private var mediaPlayer: MediaPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val alarmId = intent.getStringExtra("alarm_id") ?: ""
        val title = intent.getStringExtra("alarm_title") ?: "Llamrei Hard Alarm"

        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        runCatching {
            mediaPlayer = MediaPlayer().apply {
                setDataSource(this@AlarmRingingActivity, uri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                isLooping = true
                prepare()
                start()
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 96)
            setBackgroundColor(0xFF050507.toInt())
        }
        val tv = TextView(this).apply {
            text = "⏰ $title"
            textSize = 22f
            setTextColor(0xFF00D992.toInt())
        }
        val btnSnooze = Button(this).apply {
            text = "Snooze 10 Menit"
            setOnClickListener {
                mediaPlayer?.stop()
                thread {
                    LlamreiWidgetSync.enqueueOfflineMutation(this@AlarmRingingActivity, "alarm_snooze", alarmId, JSONObject().put("minutes", 10))
                    val snap = LlamreiWidgetSync.syncWithServer(this@AlarmRingingActivity)
                    refreshAllWidgetProviders(this@AlarmRingingActivity, snap)
                }
                finish()
            }
        }
        val btnDismiss = Button(this).apply {
            text = "Dismiss Alarm"
            setOnClickListener {
                mediaPlayer?.stop()
                thread {
                    LlamreiWidgetSync.enqueueOfflineMutation(this@AlarmRingingActivity, "alarm_dismiss", alarmId)
                    val snap = LlamreiWidgetSync.syncWithServer(this@AlarmRingingActivity)
                    refreshAllWidgetProviders(this@AlarmRingingActivity, snap)
                }
                finish()
            }
        }
        root.addView(tv)
        root.addView(btnSnooze)
        root.addView(btnDismiss)
        setContentView(root)
    }

    override fun onDestroy() {
        mediaPlayer?.release()
        mediaPlayer = null
        super.onDestroy()
    }
}

class ServerConfigActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val (lan, ts, tok) = LlamreiWidgetSync.getEndpoints(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 64)
            setBackgroundColor(0xFF050507.toInt())
        }
        val title = TextView(this).apply {
            text = "Llamrei Android Widget Config (LAN + Tailscale)"
            setTextColor(0xFF00D992.toInt())
            textSize = 16f
        }
        val etLan = EditText(this).apply {
            hint = "LAN URL (http://192.168.x.x:4321)"
            setText(lan)
            setTextColor(0xFFF2F2F2.toInt())
        }
        val etTs = EditText(this).apply {
            hint = "Tailscale Serve URL (https://laptop.tailnet.ts.net)"
            setText(ts)
            setTextColor(0xFFF2F2F2.toInt())
        }
        val etTok = EditText(this).apply {
            hint = "Bearer Token (.api.token)"
            setText(tok)
            setTextColor(0xFFF2F2F2.toInt())
        }
        val statusTv = TextView(this).apply { setTextColor(0xFF94A3B8.toInt()) }
        val btnSave = Button(this).apply {
            text = "Simpan & Sync Widget Sekarang"
            setOnClickListener {
                LlamreiWidgetSync.configureEndpoints(this@ServerConfigActivity, etLan.text.toString(), etTs.text.toString(), etTok.text.toString())
                thread {
                    val snap = LlamreiWidgetSync.syncWithServer(this@ServerConfigActivity)
                    refreshAllWidgetProviders(this@ServerConfigActivity, snap)
                    runOnUiThread {
                        statusTv.text = if (snap != null) "Tersambung & Widget Disinkronkan!" else "Tersimpan (Mode Offline Cache)"
                    }
                }
            }
        }
        val btnOpenWeb = Button(this).apply {
            text = "🌐 BUKA DASHBOARD PENUH (WEB)"
            setBackgroundColor(0xFF00D992.toInt())
            setTextColor(0xFF050507.toInt())
            setOnClickListener {
                startActivity(Intent(this@ServerConfigActivity, MainActivity::class.java))
                finish()
            }
        }
        root.addView(title); root.addView(btnOpenWeb); root.addView(etLan); root.addView(etTs); root.addView(etTok); root.addView(btnSave); root.addView(statusTv)
        setContentView(root)
    }
}
