//! Mynah desktop.
//!
//! The window is the same command line the browser build serves; the only
//! difference is where the socket lives. See `link.rs` for why it has to be
//! here rather than in the webview.

mod awj;
mod link;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use awj::{AwjMessage, AwjReply};
use link::Link;

#[tauri::command]
async fn link_connect(
    app: AppHandle,
    state: State<'_, Link>,
    host: String,
    port: u16,
) -> Result<(), String> {
    state.connect(app, host, port).await
}

#[tauri::command]
async fn link_disconnect(state: State<'_, Link>) -> Result<(), String> {
    state.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn link_write(state: State<'_, Link>, path: Vec<String>, value: Value) -> Result<(), String> {
    state.write(path, value).await
}

/// One AWJ exchange on TCP 10606. Stateless — see `awj.rs` for why.
#[tauri::command]
async fn link_awj(host: String, messages: Vec<AwjMessage>) -> Result<Vec<AwjReply>, String> {
    awj::exchange(host, messages).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(Link::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            link_connect,
            link_disconnect,
            link_write,
            link_awj
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
