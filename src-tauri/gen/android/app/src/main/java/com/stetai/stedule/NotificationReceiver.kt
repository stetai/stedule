package com.stetai.stedule

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class NotificationReceiver : BroadcastReceiver() {

    companion object {
        const val CHANNEL_ID   = "stedule_reminders"
        const val CHANNEL_NAME = "Event Reminders"
        const val EXTRA_ID     = "notification_id"
        const val EXTRA_TITLE  = "title"
        const val EXTRA_BODY   = "body"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val id    = intent.getIntExtra(EXTRA_ID, 0)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: return // abort if no title
        val body  = intent.getStringExtra(EXTRA_BODY)  ?: ""

        val mgr   = context.getSystemService(Context.NOTIFICATION_SERVICE)
                    as NotificationManager

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification) 
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true) // dismissed when tapped
            .build()

        mgr.notify(id, notification)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = context.getSharedPreferences("scheduled_notifs", Context.MODE_PRIVATE)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val now = System.currentTimeMillis()
        val editor = prefs.edit()

        for ((key, value) in prefs.all) {
            val parts = (value as? String)?.split("|") ?: continue
            if (parts.size < 4) continue

            val id        = parts[0].toIntOrNull() ?: continue
            val title     = parts[1]
            val body      = parts[2]
            val triggerMs = parts[3].toLongOrNull() ?: continue

            if (triggerMs <= now) {
                editor.remove(key)   // past — clean up
                continue
            }

            val pending = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, NotificationReceiver::class.java).apply {
                    putExtra(NotificationReceiver.EXTRA_ID,    id)
                    putExtra(NotificationReceiver.EXTRA_TITLE, title)
                    putExtra(NotificationReceiver.EXTRA_BODY,  body)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pending)
        }

        editor.apply()
    }
}