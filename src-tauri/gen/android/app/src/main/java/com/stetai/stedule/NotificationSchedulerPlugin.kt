package com.stetai.stedule

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

import app.tauri.annotation.PermissionCallback
import app.tauri.plugin.PermissionState
import android.provider.Settings
import android.net.Uri

// Data classes Tauri deserialises from the JS payload automatically
data class ScheduleArgs(val id: Int, val title: String, val body: String, val triggerMs: Long)
data class CancelArgs(val id: Int)

@TauriPlugin
class NotificationSchedulerPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun scheduleNotification(invoke: Invoke) {
        val args = invoke.parseArgs(ScheduleArgs::class.java)
        if (args.triggerMs <= System.currentTimeMillis()) {
            invoke.reject("trigger_ms is in the past or missing")
            return
        }

        val context      = activity.applicationContext
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            !alarmManager.canScheduleExactAlarms()) {
            activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
            invoke.reject("Exact alarm permission not granted. Redirecting to Settings.")
            return
        }

        // Persist so BootReceiver can rebuild after reboot
        context.getSharedPreferences("scheduled_notifs", Context.MODE_PRIVATE)
            .edit()
            .putString(args.id.toString(), "${args.id}|${args.title}|${args.body}|${args.triggerMs}")
            .apply()

        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP, 
            args.triggerMs,
            buildPendingIntent(
                context, 
                args.id, 
                args.title, 
                args.body)
        )

        invoke.resolve(JSObject())
    }

    @Command
    fun cancelNotification(invoke: Invoke) {
        val args    = invoke.parseArgs(CancelArgs::class.java)
        val context = activity.applicationContext

        context.getSharedPreferences("scheduled_notifs", Context.MODE_PRIVATE)
            .edit().remove(args.id.toString()).apply()

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager


        val pending = PendingIntent.getBroadcast(
            context, args.id,
            Intent(context, NotificationReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        alarmManager.cancel(pending)
        invoke.resolve(JSObject())
    }

    companion object {
        private const val POST_NOTIF_ALIAS = "postNotifications"
    }

    // Request runtime permission for Andriod 13+
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(invoke, arrayOf(
                android.Manifest.permission.POST_NOTIFICATIONS
            ), POST_NOTIF_ALIAS)
        } else {
            // Granted implicitly on older Android
            invoke.resolve(JSObject().put("granted", true))
        }
    }

    @PermissionCallback
    fun notificationPermissionCallback(invoke: Invoke) {
        val granted = getPermissionState("postNotifications") == PermissionState.GRANTED
        invoke.resolve(JSObject().put("granted", granted))
    }

    private fun buildPendingIntent(
        context: Context, id: Int, title: String, body: String
    ): PendingIntent {
        val intent = Intent(context, NotificationReceiver::class.java).apply {
            putExtra(NotificationReceiver.EXTRA_ID,    id)
            putExtra(NotificationReceiver.EXTRA_TITLE, title)
            putExtra(NotificationReceiver.EXTRA_BODY,  body)
        }
        return PendingIntent.getBroadcast(
            context,
            id, 
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    // Make sure exact notifications can be called
    @Command
    fun requestBatteryOptimisationExemption(invoke: Invoke) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${activity.packageName}")
        }
        activity.startActivity(intent)
        invoke.resolve(JSObject())
    }

}