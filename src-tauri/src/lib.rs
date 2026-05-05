// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::command;
use tauri_plugin_dialog::DialogExt;

/*#[command]
async fn open_calendar(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog().file()
        //.add_filter("Calendar", &["ics"]) //automatically returns null
        .pick_file(move |maybe_path| {
            // Harmless: receiver dropped.
            println!("#####dialog returned: {:?}", maybe_path);
            let _ = tx.send(maybe_path);
        });

    let maybe_path = rx.await.map_err(|e| e.to_string())?;

    let file_path = match maybe_path {
        None => return Ok(None), //user cancelled
        Some(p) => p,
    };

    let path_str = file_path.to_string();

    let name = path_str
        .split('/')
        .last()
        .unwrap_or("calendar.ics")
        .to_string();

    Ok(Some(serde_json::json!({
        "path": path_str,
        "name": name
    })))
}*/

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
