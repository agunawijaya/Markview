//! Bridge to `MarkviewBridgePlugin.kt` (in the generated Android project) for
//! the few Android services the stock Tauri plugins don't cover: the
//! read/write document picker, "Open with" intents, display names of content
//! URIs, printing, system bar colors and moving the task to the background.
//!
//! Every call blocks until Kotlin answers, and Kotlin runs on the Android UI
//! thread — so callers must invoke these from `spawn_blocking`, never from
//! the main thread.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Wry,
};

struct Bridge(PluginHandle<Wry>);

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("markview-bridge")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.markview.app", "MarkviewBridgePlugin")?;
            app.manage(Bridge(handle));
            Ok(())
        })
        .build()
}

#[derive(Deserialize)]
struct UriResponse {
    uri: Option<String>,
}

#[derive(Deserialize)]
struct NameResponse {
    name: Option<String>,
}

#[derive(Serialize)]
struct UriArgs<'a> {
    uri: &'a str,
}

#[derive(Serialize)]
struct PrintArgs {
    name: String,
}

#[derive(Serialize)]
struct ThemeArgs {
    dark: bool,
}

fn bridge(app: &AppHandle) -> Result<tauri::State<'_, Bridge>, String> {
    app.try_state::<Bridge>()
        .ok_or_else(|| "Android bridge not initialized".to_string())
}

pub fn pick_document(app: &AppHandle) -> Result<Option<String>, String> {
    let res: UriResponse = bridge(app)?
        .0
        .run_mobile_plugin("pickDocument", ())
        .map_err(|e| e.to_string())?;
    Ok(res.uri)
}

pub fn take_intent_file(app: &AppHandle) -> Option<String> {
    let res: UriResponse = bridge(app).ok()?.0.run_mobile_plugin("takeIntentFile", ()).ok()?;
    res.uri
}

pub fn display_name(app: &AppHandle, uri: &str) -> Option<String> {
    let res: NameResponse = bridge(app)
        .ok()?
        .0
        .run_mobile_plugin("displayName", UriArgs { uri })
        .ok()?;
    res.name.filter(|n| !n.is_empty())
}

pub fn print(app: &AppHandle, name: String) -> Result<(), String> {
    bridge(app)?
        .0
        .run_mobile_plugin::<serde_json::Value>("print", PrintArgs { name })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn set_system_bar_theme(app: &AppHandle, dark: bool) -> Result<(), String> {
    bridge(app)?
        .0
        .run_mobile_plugin::<serde_json::Value>("setSystemBarTheme", ThemeArgs { dark })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn move_to_back(app: &AppHandle) -> Result<(), String> {
    bridge(app)?
        .0
        .run_mobile_plugin::<serde_json::Value>("moveToBack", ())
        .map(|_| ())
        .map_err(|e| e.to_string())
}
