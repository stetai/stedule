// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::command;
use tauri_plugin_dialog::DialogExt;
use std::fs;
use std::path::PathBuf;

#[command]
async fn open_calendar(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog().file()
        .add_filter("Calendar", &["ics"])
        .pick_file(move |maybe_path| {
            // Harmless: receiver dropped.
            let _ = tx.send(maybe_path);
        });

    let maybe_path = rx.await.map_err(|e| e.to_string())?;

    let file_path = match maybe_path {
        None => return Ok(None), //user cancelled
        Some(p) => p,
    };

    let path: PathBuf = match file_path {
        tauri_plugin_dialog::FilePath::Path(p) => p,
        tauri_plugin_dialog::FilePath::Url(u) => {
            return Err(format!("Unsupported file URL: {}", u));
        }
    };

    // to_string_lossy() gives the path string on both PathBuf (desktop) and content URI (Android).
    let path_str = path.to_string_lossy().to_string();
    let name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "calendar.ics".to_string());
    let content = fs::read_to_string(&path)
        .map_err(|e| e.to_string())?;

    Ok(Some(serde_json::json!({
        "path": path_str,
        "name": name,
        "content": content
    })))
}

#[command]
fn save_calendar(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
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
