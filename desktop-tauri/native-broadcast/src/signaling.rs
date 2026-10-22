//! PeerJS signaling: the hosted PeerServer's WebSocket protocol, the same envelope peerjs 1.5.5
//! (src/lib/peer.ts) and the Android PeerSignalingClient speak. The server stamps `src` on what it
//! relays; clients only send `type`, `dst` and `payload`.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

// peerjs's Socket pings every 5 s; the server drops a client it has not heard from in a while.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub(crate) enum Inbound {
    Open,
    IdTaken,
    Error(String),
    Offer { src: String, payload: Value },
    Candidate { payload: Value },
    Leave { src: String },
    Expire { src: String },
    /// The socket is gone; nothing else arrives after this.
    Closed,
}

enum Command {
    Text(String),
    Close,
}

#[derive(Clone)]
pub(crate) struct Outbound(mpsc::UnboundedSender<Command>);

impl Outbound {
    pub fn signal(&self, kind: &str, dst: &str, payload: Value) {
        let message = json!({ "type": kind, "dst": dst, "payload": payload });
        let _ = self.0.send(Command::Text(message.to_string()));
    }

    pub fn leave(&self, dst: &str) {
        let message = json!({ "type": "LEAVE", "dst": dst });
        let _ = self.0.send(Command::Text(message.to_string()));
    }

    pub fn close(&self) {
        let _ = self.0.send(Command::Close);
    }
}

pub(crate) fn socket_url(server: &str, id: &str) -> String {
    let token = uuid::Uuid::new_v4().simple().to_string();
    format!("{server}?key=peerjs&id={id}&token={token}&version=1.5.5")
}

/// Opens the socket. The caller waits for `Inbound::Open` (or `IdTaken`) before announcing the live.
pub(crate) async fn connect(server: &str, id: &str) -> Result<(Outbound, mpsc::UnboundedReceiver<Inbound>), String> {
    let (socket, _) = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(socket_url(server, id)))
        .await
        .map_err(|_| "O servidor de sinalização não respondeu.".to_string())?
        .map_err(|error| format!("Não foi possível conectar à sinalização: {error}"))?;
    let (mut sink, mut stream) = socket.split();
    let (command_tx, mut command_rx) = mpsc::unbounded_channel::<Command>();
    let (inbound_tx, inbound_rx) = mpsc::unbounded_channel::<Inbound>();

    tokio::spawn(async move {
        let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
        heartbeat.tick().await;
        loop {
            tokio::select! {
                command = command_rx.recv() => match command {
                    Some(Command::Text(text)) => {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Some(Command::Close) | None => {
                        let _ = sink.send(Message::Close(None)).await;
                        break;
                    }
                },
                _ = heartbeat.tick() => {
                    if sink.send(Message::Text(r#"{"type":"HEARTBEAT"}"#.into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    tokio::spawn(async move {
        while let Some(message) = stream.next().await {
            let text = match message {
                Ok(Message::Text(text)) => text.to_string(),
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => continue,
            };
            if let Some(inbound) = parse(&text) {
                if inbound_tx.send(inbound).is_err() {
                    return;
                }
            }
        }
        let _ = inbound_tx.send(Inbound::Closed);
    });

    Ok((Outbound(command_tx), inbound_rx))
}

fn parse(text: &str) -> Option<Inbound> {
    let value: Value = serde_json::from_str(text).ok()?;
    let kind = value.get("type")?.as_str()?;
    let src = value.get("src").and_then(Value::as_str).map(str::to_string);
    let payload = value.get("payload").cloned();
    Some(match (kind, src, payload) {
        ("OPEN", _, _) => Inbound::Open,
        ("ID-TAKEN", _, _) => Inbound::IdTaken,
        ("ERROR", _, payload) | ("INVALID-KEY", _, payload) => Inbound::Error(
            payload
                .as_ref()
                .and_then(|payload| payload.get("msg"))
                .and_then(Value::as_str)
                .unwrap_or(kind)
                .to_string(),
        ),
        ("OFFER", Some(src), Some(payload)) => Inbound::Offer { src, payload },
        ("CANDIDATE", Some(_), Some(payload)) => Inbound::Candidate { payload },
        ("LEAVE", Some(src), _) => Inbound::Leave { src },
        ("EXPIRE", Some(src), _) => Inbound::Expire { src },
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_server_messages() {
        assert!(matches!(parse(r#"{"type":"OPEN"}"#), Some(Inbound::Open)));
        assert!(matches!(parse(r#"{"type":"ID-TAKEN","payload":{"msg":"taken"}}"#), Some(Inbound::IdTaken)));
        let offer = parse(r#"{"type":"OFFER","src":"v1","dst":"h","payload":{"type":"media","connectionId":"mc_1"}}"#);
        assert!(matches!(offer, Some(Inbound::Offer { ref src, .. }) if src == "v1"));
        assert!(matches!(parse(r#"{"type":"LEAVE","src":"v1"}"#), Some(Inbound::Leave { .. })));
        assert!(parse(r#"{"type":"HEARTBEAT"}"#).is_none());
        assert!(parse("not json").is_none());
    }

    #[test]
    fn builds_the_peerjs_socket_url() {
        let url = socket_url("wss://peerjs.example/peerjs/peerjs", "abc");
        assert!(url.starts_with("wss://peerjs.example/peerjs/peerjs?key=peerjs&id=abc&token="));
        assert!(url.ends_with("&version=1.5.5"));
    }
}
