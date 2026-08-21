//! A round trip against a real Web RCS socket.
//!
//! `#[ignore]` by default because it needs a LivePremier or the simulator
//! listening. Run it deliberately:
//!
//!     cargo test --test live -- --ignored --nocapture
//!
//! It proves the thing the unit tests cannot: that the frame this app builds is
//! one a device accepts, and that the echo comes back in the shape the app
//! expects. The command it sends is a Take on S1, which is safe on a simulator
//! and reversible on a bench device — it never writes a memory.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 3000;

#[tokio::test]
#[ignore]
async fn a_take_is_echoed_back_by_the_device() {
    let (stream, _) = tokio_tungstenite::connect_async(format!("ws://{HOST}:{PORT}/"))
        .await
        .expect("the simulator should be listening");
    let (mut sink, mut source) = stream.split();

    let path = json!(["device", "screenAuxGroupList", "items", "S1", "control", "pp", "xTake"]);
    let frame = json!({ "channel": "DEVICE", "data": { "path": path, "value": true } });
    sink.send(Message::Text(frame.to_string()))
        .await
        .expect("send should succeed");

    // The device echoes a write back on the DEVICE channel. Anything else on
    // the socket is other traffic and is skipped.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
        let Some(Ok(msg)) = source.next().await else { break };
        let Message::Text(text) = msg else { continue };

        // Keepalives are bare text, not JSON.
        if text == "0x9" {
            sink.send(Message::Text("0xA".into())).await.ok();
            continue;
        }

        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        if v.get("channel").and_then(Value::as_str) != Some("DEVICE") {
            continue;
        }
        if v.pointer("/data/path") == Some(&path) {
            assert_eq!(
                v.pointer("/data/value"),
                Some(&Value::Bool(true)),
                "the echo should carry the value we sent"
            );
            println!("echo received: {text}");
            return;
        }
    }
    panic!("no echo of the Take within 5s");
}
