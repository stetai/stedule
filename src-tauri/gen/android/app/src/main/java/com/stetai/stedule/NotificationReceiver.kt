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

        val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE)
                    as NotificationManager

        // Channels required on Android 8+. 
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH   // shows as heads-up banner
            ).apply {
                description = "Upcoming event reminders from Stedule"
                enableVibration(true)
            }
            mgr.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification) // add a 24dp white icon to res/drawable
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
        // Read persisted scheduled notifications from SharedPreferences or a local DB,
        // then call AlarmManager.setExactAndAllowWhileIdle() for each future one.
        // We'll implement the persistence layer in the next step.
    }
}