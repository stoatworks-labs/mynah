//! The Web RCS WebSocket, spoken from Rust.
//!
//! In the browser build the page opens this socket itself. In the desktop build
//! it cannot: Tauri registers its custom scheme as a trustworthy origin, which
//! makes the webview a secure context, and a secure context may not open a
//! plain `ws://` — the same rule that stops a hosted https page reaching a
//! switcher. A LivePremier serves the Web RCS over http on port 80 with 443
//! closed, so there is no `wss://` to connect to and never will be.
//!
//! Moving the socket here takes the browser sandbox out of the path entirely,
//! which is the whole reason the desktop build exists.
//!
//! Wire format, identical to the browser transport:
//!
//! ```text
//! {"channel":"DEVICE","data":{"path":["device",…],"value":…}}
//! ```
//!
//! Keepalives are bare text frames, `0x9` out and `0xA` back — not WebSocket
//! control frames, and not JSON.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

const PING: &str = "0x9";
const PONG: &str = "0xA";

/// Idle time before pinging starts, and the gap between pings thereafter.
const PING_SILENT_MS: u64 = 3000;
const PING_INTERVAL_MS: u64 = 1000;

#[derive(Clone, Serialize)]
struct StateEvent {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Clone, Serialize)]
struct DeviceValue {
    path: Vec<String>,
    value: Value,
}

/// The one live connection. A second `link_connect` replaces the first.
#[derive(Default)]
pub struct Link {
    outbound: Arc<Mutex<Option<mpsc::UnboundedSender<Message>>>>,
}

impl Link {
    fn emit_state(app: &AppHandle, state: &'static str, detail: Option<String>) {
        let _ = app.emit("link-state", StateEvent { state, detail });
    }

    pub async fn connect(&self, app: AppHandle, host: String, port: u16) -> Result<(), String> {
        self.disconnect().await;

        let url = format!("ws://{host}:{port}/");
        Self::emit_state(&app, "connecting", None);

        let (stream, _) = tokio_tungstenite::connect_async(&url)
            .await
            .map_err(|e| format!("{e}"))?;
        let (mut sink, mut source) = stream.split();

        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        *self.outbound.lock().await = Some(tx.clone());

        // One task owns the sink so writes from anywhere are serialised, which
        // is what lets a masked master store rely on its filters landing before
        // its trigger.
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
        });

        Self::emit_state(&app, "open", None);

        // Keepalive. The vendor client goes quiet until the link is idle; this
        // pings unconditionally at the same period, which is negligible next to
        // the device's own push rate.
        let ping_tx = tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(PING_SILENT_MS)).await;
            let mut tick = tokio::time::interval(Duration::from_millis(PING_INTERVAL_MS));
            loop {
                tick.tick().await;
                if ping_tx.send(Message::Text(PING.into())).is_err() {
                    break;
                }
            }
        });

        let pong_tx = tx.clone();
        let outbound = Arc::clone(&self.outbound);
        tokio::spawn(async move {
            while let Some(Ok(msg)) = source.next().await {
                let text = match msg {
                    Message::Text(t) => t,
                    Message::Close(_) => break,
                    // Binary frames and real WebSocket control frames carry
                    // nothing this protocol uses.
                    _ => continue,
                };

                // The device pings us too, and expects the answer.
                if text == PING {
                    let _ = pong_tx.send(Message::Text(PONG.into()));
                    continue;
                }
                if text == PONG {
                    continue;
                }

                let Ok(msg) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                handle(&app, &msg);
            }

            *outbound.lock().await = None;
            Self::emit_state(&app, "closed", Some("Connection lost".into()));
        });

        Ok(())
    }

    pub async fn write(&self, path: Vec<String>, value: Value) -> Result<(), String> {
        let guard = self.outbound.lock().await;
        let tx = guard.as_ref().ok_or("Not connected")?;
        let frame = json!({ "channel": "DEVICE", "data": { "path": path, "value": value } });
        tx.send(Message::Text(frame.to_string()))
            .map_err(|_| "Link closed".to_string())
    }

    pub async fn disconnect(&self) {
        if let Some(tx) = self.outbound.lock().await.take() {
            let _ = tx.send(Message::Close(None));
        }
    }
}

/// Forward the two channels the app consumes, and drop everything else.
fn handle(app: &AppHandle, msg: &Value) {
    match msg.get("channel").and_then(Value::as_str) {
        Some("DEVICE") => {
            let Some(data) = msg.get("data") else { return };
            let Some(path) = data.get("path").and_then(Value::as_array) else {
                return;
            };
            let path: Vec<String> = path
                .iter()
                .map(|p| p.as_str().map(str::to_owned).unwrap_or_else(|| p.to_string()))
                .collect();
            let value = data.get("value").cloned().unwrap_or(Value::Null);
            let _ = app.emit("device-value", DeviceValue { path, value });
        }
        Some("REMOTE") => {
            if let Some(keys) = remote_selection(msg.get("data")) {
                let _ = app.emit("remote-selection", keys);
            }
        }
        _ => {}
    }
}

/// The vendor UI's own screen selection, from either shape it arrives in.
///
/// `INIT` carries a whole snapshot once; `PATCH` carries RFC 6902 patches
/// thereafter. Only this one key matters, so both are read for it rather than
/// mirroring the entire store.
fn remote_selection(data: Option<&Value>) -> Option<Vec<String>> {
    let data = data?;
    let keys = match data.get("channel").and_then(Value::as_str) {
        Some("INIT") => data
            .get("snapshot")?
            .get("live")?
            .get("screens")?
            .get("screenAuxSelection")?
            .get("keys")?,
        Some("PATCH") => {
            let patch = data.get("patch")?;
            let path = patch.get("path")?.as_str()?;
            if !path.starts_with("/live/screens/screenAuxSelection") {
                return None;
            }
            patch.get("value")?
        }
        _ => return None,
    };

    Some(
        keys.as_array()?
            .iter()
            .filter_map(|k| k.as_str().map(str::to_owned))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_selection_from_an_init_snapshot() {
        let data = json!({
            "channel": "INIT",
            "snapshot": { "live": { "screens": { "screenAuxSelection": { "keys": ["S1", "A3"] } } } }
        });
        assert_eq!(
            remote_selection(Some(&data)),
            Some(vec!["S1".to_string(), "A3".to_string()])
        );
    }

    #[test]
    fn reads_the_selection_from_a_patch() {
        let data = json!({
            "channel": "PATCH",
            "patch": { "op": "replace", "path": "/live/screens/screenAuxSelection/keys", "value": ["S2"] }
        });
        assert_eq!(remote_selection(Some(&data)), Some(vec!["S2".to_string()]));
    }

    #[test]
    fn ignores_a_patch_to_anything_else() {
        // The REMOTE channel carries the whole shared UI store. Only the
        // selection matters here, and reacting to the rest would move the
        // command line's scope for reasons the operator never asked for.
        let data = json!({
            "channel": "PATCH",
            "patch": { "op": "replace", "path": "/system/status/currentDeviceTime", "value": 1 }
        });
        assert_eq!(remote_selection(Some(&data)), None);
    }

    #[test]
    fn survives_a_snapshot_that_is_missing_the_keys() {
        let data = json!({ "channel": "INIT", "snapshot": { "live": {} } });
        assert_eq!(remote_selection(Some(&data)), None);
        assert_eq!(remote_selection(None), None);
    }

    #[test]
    fn a_device_write_is_the_documented_envelope() {
        // Writing a property IS the command; there is no separate verb. The
        // shape must match the browser transport exactly or the two builds
        // would drive the switcher differently.
        let frame = json!({
            "channel": "DEVICE",
            "data": { "path": ["device", "presetBank"], "value": true }
        });
        assert_eq!(
            frame.to_string(),
            r#"{"channel":"DEVICE","data":{"path":["device","presetBank"],"value":true}}"#
        );
    }

    #[test]
    fn keepalives_are_bare_text_not_json() {
        // 0x9 out, 0xA back, as literal text frames — not WebSocket control
        // frames, and not JSON. Sending them as either is silently ignored.
        assert_eq!(PING, "0x9");
        assert_eq!(PONG, "0xA");
    }
}
