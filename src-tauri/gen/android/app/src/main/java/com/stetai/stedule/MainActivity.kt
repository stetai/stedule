package com.stetai.stedule

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import app.tauri.plugin.PluginManager

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(NotificationSchedulerPlugin::class.java)
    PluginManager.onActivityCreate(this)
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
  }
}
