//! AWJ over TCP 10606, spoken from Rust.
//!
//! The other half of why the desktop build exists. `link.rs` moved the Web RCS
//! WebSocket here because a webview may not open a plain `ws://`; this moves
//! the AWJ socket here because no browser may open a raw TCP socket at all,
//! ever, by any route. A message typed at the command line in a tab is
//! converted to the store spelling and sent on the WebSocket, which lands in
//! the same place — but a `get` has nowhere to come back from, because that
//! socket is a stream of changes rather than a request/response channel. Here
//! it is just a socket, and a reply is just the next thing on it.
//!
//! ## The wire
//!
//! One JSON object per message, terminated by ASCII `0x04` — not a newline,
//! which is the detail that catches out anyone who reads "JSON" and reaches
//! for a line codec. Replies are the same shape:
//!
//! ```text
//! {"op":"get","path":"DeviceObject/system/$device/@items/1/@props/dev"}\x04
//! {"path":"DeviceObject/system/$device/@items/1/@props/dev","value":"NLC_RS4"}\x04
//! ```
//!
//! ## One connection per exchange, and why
//!
//! The device permits five AWJ clients and counts them. Holding a connection
//! open between commands would spend one of five scarce slots on an idle
//! console, and would put this app in the device's own client list for the
//! whole show. Connecting per call costs a few milliseconds.
//!
//! ## A write is not acknowledged
//!
//! A `replace` produces no reply at all — success is silent, exactly as it is
//! on the WebSocket. So this waits for replies only when a `get` was sent, and
//! it stops as soon as it has one per `get`. Waiting for a reply to a write
//! would time out on every successful command.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// The AWJ control port. Fixed by the vendor; can be switched off in the Web
/// RCS security settings, which is worth suggesting before blaming the code.
pub const PORT: u16 = 10606;

/// The message terminator. ASCII end-of-transmission, not a newline.
const EOT: u8 = 0x04;

/// How long to wait for the replies to a batch of gets.
const REPLY_TIMEOUT: Duration = Duration::from_millis(2000);

/// How long to wait for the socket itself.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(3000);

#[derive(Deserialize)]
pub struct AwjMessage {
    pub op: String,
    pub path: String,
    #[serde(default)]
    pub value: Value,
}

#[derive(Clone, Serialize)]
pub struct AwjReply {
    pub path: String,
    pub value: Value,
}

pub async fn exchange(host: String, messages: Vec<AwjMessage>) -> Result<Vec<AwjReply>, String> {
    if messages.is_empty() {
        return Ok(Vec::new());
    }

    let expected = messages.iter().filter(|m| m.op == "get").count();

    let addr = format!("{host}:{PORT}");
    let mut stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("no answer from {addr} — AWJ can be switched off in the Web RCS security settings"))?
        .map_err(|e| format!("{addr}: {e}"))?;

    // Nagle would hold a short message back waiting for company. Every message
    // here is short and every one of them is a command.
    let _ = stream.set_nodelay(true);

    let mut out = Vec::new();
    for m in &messages {
        let obj = if m.op == "get" {
            json!({ "op": "get", "path": m.path })
        } else {
            json!({ "op": "replace", "path": m.path, "value": m.value })
        };
        out.extend_from_slice(obj.to_string().as_bytes());
        out.push(EOT);
    }
    stream
        .write_all(&out)
        .await
        .map_err(|e| format!("send failed: {e}"))?;

    if expected == 0 {
        // A replace is answered with silence. Nothing to wait for, and the
        // socket closing is not a failure.
        let _ = stream.shutdown().await;
        return Ok(Vec::new());
    }

    let replies = tokio::time::timeout(REPLY_TIMEOUT, read_replies(&mut stream, expected))
        .await
        .map_err(|_| {
            format!("no reply within {}ms — the path may not exist on this firmware", REPLY_TIMEOUT.as_millis())
        })??;

    let _ = stream.shutdown().await;
    Ok(replies)
}

/// Read until `expected` replies have arrived, or the device hangs up.
///
/// Frames are split on `0x04` across reads: a reply may straddle a read
/// boundary and several may share one, so the buffer is carried between
/// iterations rather than parsed per chunk.
async fn read_replies(stream: &mut TcpStream, expected: usize) -> Result<Vec<AwjReply>, String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut replies = Vec::new();

    loop {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            // The device closed. Whatever arrived is what there is.
            return Ok(replies);
        }
        buf.extend_from_slice(&chunk[..n]);

        while let Some(i) = buf.iter().position(|b| *b == EOT) {
            let frame: Vec<u8> = buf.drain(..=i).take(i).collect();
            if frame.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_slice::<Value>(&frame) {
                let path = v.get("path").and_then(Value::as_str).unwrap_or_default();
                replies.push(AwjReply {
                    path: path.to_string(),
                    value: v.get("value").cloned().unwrap_or(Value::Null),
                });
            }
            if replies.len() >= expected {
                return Ok(replies);
            }
        }
    }
}
