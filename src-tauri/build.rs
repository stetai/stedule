fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "notification-scheduler",
                tauri_build::InlinedPlugin::new().commands(&[
                    "schedule_notification",
                    "cancel_notification",
                    "request_notification_permission",
                ]),
            )
    )
    .expect("failed to run tauri-build");
}