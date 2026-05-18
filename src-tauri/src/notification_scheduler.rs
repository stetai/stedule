use serde::Serialize;
use tauri::{plugin::{Builder, TauriPlugin}, AppHandle, Manager, Runtime};

// These structs are serialised to JSON and sent to Kotlin's parseArgs()
#[derive(Serialize)]
struct SchedulePayload {
    id:         i32,
    title:      String,
    body:       String,
    #[serde(rename = "triggerMs")]
    trigger_ms: i64,
}

#[derive(Serialize)]
struct CancelPayload {
    id: i32,
}

#[derive(serde::Deserialize)]
struct PermissionResult {
    granted: bool,
}

#[derive(Serialize)]
struct EmptyPayload {}

#[cfg(mobile)]
struct MobileNotificationPlugin<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
pub async fn request_notification_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        let plugin = app.state::<MobileNotificationPlugin<R>>();
        let result: PermissionResult = plugin
            .0
            .run_mobile_plugin("requestNotificationPermission", EmptyPayload {})
            .map_err(|e| e.to_string())?;
        return Ok(result.granted);
    }
    #[cfg(not(mobile))]
    Ok(true)
}

#[tauri::command]
pub async fn schedule_notification<R: Runtime>(
    app:        AppHandle<R>,
    id:         i32,
    title:      String,
    body:       String,
    trigger_ms: i64,
) -> Result<(), String> {
    // cfg gate: only compiles for Android targets.
    // desktop build still exposes the command as no-op.
    #[cfg(mobile)]
    {
        let plugin = app.state::<MobileNotificationPlugin<R>>();
        plugin
            .0
            .run_mobile_plugin::<()>("scheduleNotification", SchedulePayload {
                id, title, body, trigger_ms,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_notification<R: Runtime>(
    app: AppHandle<R>,
    id:  i32,
) -> Result<(), String> {
    #[cfg(mobile)]
    {   
        let plugin = app.state::<MobileNotificationPlugin<R>>();
        plugin
            .0
            .run_mobile_plugin::<()>("cancelNotification", CancelPayload { id })
                .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("notification-scheduler")
        .setup(|app, api| {
            #[cfg(mobile)]
            {
                let handle = api.register_android_plugin(
                    "com.stetai.stedule",       // your Android package name
                    "NotificationSchedulerPlugin", // the Kotlin class name
                )?;
                app.manage(MobileNotificationPlugin(handle));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            schedule_notification,
            cancel_notification,
            request_notification_permission,
        ])
        .build()
}