use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct AppState {
    watched_path: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    last_file: Mutex<Option<String>>,
    pending_files: Mutex<HashMap<String, String>>,
}

#[derive(Clone, Serialize)]
struct FileContent {
    content: String,
    path: String,
    dir: String,
    filename: String,
}

#[tauri::command]
fn read_file(path: String) -> Result<FileContent, String> {
    let p = PathBuf::from(&path);
    let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let dir = p
        .parent()
        .map(|d| d.to_string_lossy().to_string())
        .unwrap_or_default();
    let filename = p
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(FileContent {
        content,
        path,
        dir,
        filename,
    })
}

#[tauri::command]
fn watch_file(path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let state = app_handle.state::<AppState>();

    // Store last file path
    {
        let mut last = state.last_file.lock().map_err(|e| e.to_string())?;
        *last = Some(path.clone());
    }

    // Save to local data for persistence
    if let Some(app_dir) = app_handle.path().app_local_data_dir().ok() {
        let _ = fs::create_dir_all(&app_dir);
        let _ = fs::write(app_dir.join("last_file.txt"), &path);
    }

    let file_path = PathBuf::from(&path);
    let emit_handle = app_handle.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if event.kind.is_modify() {
                    let p = event.paths.first().cloned();
                    if let Some(changed_path) = p {
                        if let Ok(content) = fs::read_to_string(&changed_path) {
                            let dir = changed_path
                                .parent()
                                .map(|d| d.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let filename = changed_path
                                .file_name()
                                .map(|f| f.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let _ = emit_handle.emit(
                                "file-changed",
                                FileContent {
                                    content,
                                    path: changed_path.to_string_lossy().to_string(),
                                    dir,
                                    filename,
                                },
                            );
                        }
                    }
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(file_path.as_ref(), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    // Store watcher and path
    {
        let mut wp = state.watched_path.lock().map_err(|e| e.to_string())?;
        *wp = Some(file_path);
    }
    {
        let mut w = state.watcher.lock().map_err(|e| e.to_string())?;
        *w = Some(watcher);
    }

    Ok(())
}

#[tauri::command]
fn unwatch_file(app_handle: tauri::AppHandle) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    {
        let mut w = state.watcher.lock().map_err(|e| e.to_string())?;
        *w = None;
    }
    {
        let mut wp = state.watched_path.lock().map_err(|e| e.to_string())?;
        *wp = None;
    }
    Ok(())
}

#[tauri::command]
fn get_last_file(app_handle: tauri::AppHandle) -> Option<String> {
    if let Some(app_dir) = app_handle.path().app_local_data_dir().ok() {
        if let Ok(path) = fs::read_to_string(app_dir.join("last_file.txt")) {
            if PathBuf::from(&path).exists() {
                return Some(path);
            }
        }
    }
    None
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_base64_file(path: String, base64_data: String) -> Result<(), String> {
    use std::io::Write;
    let bytes = base64_decode(&base64_data).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buf: Vec<u8> = Vec::with_capacity(input.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &c in input.as_bytes() {
        if c == b'=' {
            break;
        }
        let val = table.iter().position(|&x| x == c)
            .ok_or_else(|| format!("Invalid base64 character: {}", c as char))? as u32;
        acc = (acc << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            buf.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(buf)
}

#[tauri::command]
fn quit_app() {
    std::process::exit(0);
}

#[tauri::command]
fn store_pending_file(label: String, file_path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    let mut pending = state.pending_files.lock().map_err(|e| e.to_string())?;
    pending.insert(label, file_path);
    Ok(())
}

#[tauri::command]
fn get_pending_file(window: tauri::Window, app_handle: tauri::AppHandle) -> Option<String> {
    let label = window.label().to_string();
    let state = app_handle.state::<AppState>();
    let mut pending = state.pending_files.lock().ok()?;
    pending.remove(&label)
}

#[tauri::command]
fn save_preference(key: String, value: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(app_dir) = app_handle.path().app_local_data_dir().ok() {
        let _ = fs::create_dir_all(&app_dir);
        fs::write(app_dir.join(format!("pref_{}.txt", key)), value).map_err(|e| e.to_string())
    } else {
        Err("Could not find app data dir".to_string())
    }
}

#[tauri::command]
fn load_preference(key: String, app_handle: tauri::AppHandle) -> Option<String> {
    if let Some(app_dir) = app_handle.path().app_local_data_dir().ok() {
        fs::read_to_string(app_dir.join(format!("pref_{}.txt", key))).ok()
    } else {
        None
    }
}

#[tauri::command]
fn get_cli_file() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    // The first arg is the exe path, the second (if any) is the file path
    if args.len() > 1 {
        let path = PathBuf::from(&args[1]);
        if path.exists() && path.extension().map(|e| e == "md").unwrap_or(false) {
            return Some(args[1].clone());
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            watched_path: Mutex::new(None),
            watcher: Mutex::new(None),
            last_file: Mutex::new(None),
            pending_files: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            watch_file,
            unwatch_file,
            get_last_file,
            save_file,
            save_base64_file,
            quit_app,
            store_pending_file,
            get_pending_file,
            save_preference,
            load_preference,
            get_cli_file,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
