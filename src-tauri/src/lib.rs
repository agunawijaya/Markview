use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

#[cfg(target_os = "android")]
mod android;

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

/// Android hands out `content://` URIs (file picker, "Open with", Save As)
/// instead of filesystem paths. They have no parent directory and must be
/// opened through the fs plugin, which goes via the Android ContentResolver.
fn is_content_uri(path: &str) -> bool {
    path.starts_with("content://")
}

fn open_content_uri(
    app_handle: &tauri::AppHandle,
    uri: &str,
    opts: OpenOptions,
) -> Result<fs::File, String> {
    let url = tauri::Url::parse(uri).map_err(|e| e.to_string())?;
    app_handle
        .fs()
        .open(FilePath::Url(url), opts)
        .map_err(|e| e.to_string())
}

fn write_content_uri(app_handle: &tauri::AppHandle, uri: &str, bytes: &[u8]) -> Result<(), String> {
    let mut opts = OpenOptions::new();
    opts.write(true).truncate(true);
    let mut file = open_content_uri(app_handle, uri, opts)?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

/// Human-readable name for a path or content URI ("notes.md").
fn display_name_of(app_handle: &tauri::AppHandle, path: &str) -> String {
    if is_content_uri(path) {
        #[cfg(target_os = "android")]
        if let Some(name) = android::display_name(app_handle, path) {
            return name;
        }
        let _ = app_handle;
        // Fallback: last URI segment, percent-decoded, after any "primary:"-style prefix.
        let last = path.rsplit('/').next().unwrap_or(path);
        let decoded = percent_decode(last);
        return decoded
            .rsplit(|c| c == ':' || c == '/')
            .next()
            .unwrap_or(&decoded)
            .to_string();
    }
    PathBuf::from(path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
async fn read_file(path: String, app_handle: tauri::AppHandle) -> Result<FileContent, String> {
    if is_content_uri(&path) {
        return tauri::async_runtime::spawn_blocking(move || {
            let mut opts = OpenOptions::new();
            opts.read(true);
            let mut content = String::new();
            open_content_uri(&app_handle, &path, opts)?
                .read_to_string(&mut content)
                .map_err(|e| e.to_string())?;
            let filename = display_name_of(&app_handle, &path);
            Ok(FileContent {
                content,
                path,
                dir: String::new(),
                filename,
            })
        })
        .await
        .map_err(|e| e.to_string())?;
    }

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

    // Content URIs have no filesystem path for inotify to watch.
    if is_content_uri(&path) {
        let mut w = state.watcher.lock().map_err(|e| e.to_string())?;
        *w = None;
        return Ok(());
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
            // A content URI can't be stat'ed; the caller just tries to read it.
            if is_content_uri(&path) || PathBuf::from(&path).exists() {
                return Some(path);
            }
        }
    }
    None
}

#[tauri::command]
async fn save_file(path: String, content: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    if is_content_uri(&path) {
        return tauri::async_runtime::spawn_blocking(move || {
            write_content_uri(&app_handle, &path, content.as_bytes())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_base64_file(
    path: String,
    base64_data: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let bytes = base64_decode(&base64_data).map_err(|e| e.to_string())?;
    if is_content_uri(&path) {
        return tauri::async_runtime::spawn_blocking(move || {
            write_content_uri(&app_handle, &path, &bytes)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())
}

/// Filename to show for a saved path or content URI (Save As on Android
/// returns an opaque URI, so the frontend can't derive the name itself).
#[tauri::command]
async fn file_display_name(path: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || display_name_of(&app_handle, &path))
        .await
        .map_err(|e| e.to_string())
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
async fn get_cli_file(app_handle: tauri::AppHandle) -> Option<String> {
    // Android: a file handed over by "Open with Markview" (consumed once, so
    // the frontend can poll again when the app is brought back to the front).
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || android::take_intent_file(&app_handle))
        .await
        .ok()
        .flatten();

    #[cfg(not(target_os = "android"))]
    {
        let _ = app_handle;
        cli_file_from_args()
    }
}

// --- Android-only bridge commands (no-ops / errors elsewhere) ---

/// Android system document picker (ACTION_OPEN_DOCUMENT, which grants write
/// access so Save works on the opened file). Returns a content URI.
#[tauri::command]
async fn pick_document(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || android::pick_document(&app_handle))
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "android"))]
    {
        let _ = app_handle;
        Err("pick_document is only available on Android".to_string())
    }
}

/// Android print dialog for the current page (window.print() is a no-op in
/// Android WebView). "Save as PDF" is one of the system's printers.
#[tauri::command]
async fn print_document(name: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || android::print(&app_handle, name))
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "android"))]
    {
        let _ = (name, app_handle);
        Err("print_document is only available on Android".to_string())
    }
}

/// Match the Android status/navigation bar strips to the app's light/dark theme.
#[tauri::command]
async fn set_system_bar_theme(dark: bool, app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || android::set_system_bar_theme(&app_handle, dark))
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "android"))]
    {
        let _ = (dark, app_handle);
        Ok(())
    }
}

/// Android Back on the root screen: send the app to the background like
/// other Android apps do, instead of killing the process.
#[tauri::command]
async fn move_app_to_back(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return tauri::async_runtime::spawn_blocking(move || android::move_to_back(&app_handle))
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "android"))]
    {
        let _ = app_handle;
        Ok(())
    }
}

#[cfg(not(target_os = "android"))]
fn cli_file_from_args() -> Option<String> {
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(android::init());

    builder
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
            file_display_name,
            pick_document,
            print_document,
            set_system_bar_theme,
            move_app_to_back,
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
