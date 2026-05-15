package com.stetai.stedule

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import app.tauri.plugin.PluginManager

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    registerPlugin(NotificationSchedulerPlugin::class.java)
    PluginManager.onActivityCreate(this)
    enableEdgeToEdge()

    // Channels required on Android 8+. 
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val mgr = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            NotificationReceiver.CHANNEL_ID,
            NotificationReceiver.CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH   // shows as heads-up banner
        ).apply {
            description = "Upcoming event reminders from Stedule"
            enableVibration(true)
        }
        mgr.createNotificationChannel(channel)
    }
  }
}
