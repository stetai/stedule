// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::command;
use tauri_plugin_dialog::DialogExt;

#[command]
async fn open_calendar(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        //.add_filter("Calendar", &["ics"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });

    let maybe_path = rx.await.map_err(|e| e.to_string())?;

    Ok(maybe_path.map(|p| p.to_string()))
}

#[command]
fn save_calendar(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_calendar, save_calendar])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
