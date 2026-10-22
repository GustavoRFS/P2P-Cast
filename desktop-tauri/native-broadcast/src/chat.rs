//! The chat over PeerJS data connections, mirroring src/lib/chat.ts: viewers send `{ text, name }`,
//! the broadcaster relays full `ChatMessage`s. Each connection picks its own wire format.

use crate::binarypack::{self, Value};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CHAT_CONNECTION_ROLE: &str = "chat";
const CHAT_MAX_MESSAGE_LENGTH: usize = 500;
const CHAT_MAX_NAME_LENGTH: usize = 40;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub author_name: String,
    pub text: String,
    pub timestamp: i64,
    pub is_broadcaster: bool,
}

impl ChatMessage {
    pub fn new(text: String, author_name: String, is_broadcaster: bool) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as i64);
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            author_name,
            text,
            timestamp,
            is_broadcaster,
        }
    }
}

pub fn sanitize_text(raw: &str) -> String {
    raw.trim().chars().take(CHAT_MAX_MESSAGE_LENGTH).collect()
}

pub fn resolve_author_name(raw: Option<&str>, viewer_index: usize) -> String {
    match raw.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => name.chars().take(CHAT_MAX_NAME_LENGTH).collect(),
        None => format!("Espectador {viewer_index}"),
    }
}

/// The `serialization` a PeerJS data connection announced in its offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Serialization {
    /// "binary" / "default" (the browser viewers): BinaryPack.
    Binary,
    /// "json" (the Android viewer): UTF-8 JSON.
    Json,
    /// "raw" / "none": the payload is passed through as is; read and written as JSON text.
    Raw,
}

impl Serialization {
    pub fn from_offer(value: Option<&str>) -> Self {
        match value {
            Some("json") => Serialization::Json,
            Some("raw") | Some("none") => Serialization::Raw,
            _ => Serialization::Binary,
        }
    }
}

/// What a data channel message from a viewer means.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    Message { text: String, name: Option<String> },
    /// PeerJS's own `{ __peerData: { type: "close" } }`.
    Close,
    Ignored,
}

pub fn decode(serialization: Serialization, data: &[u8]) -> Incoming {
    match serialization {
        Serialization::Binary => match binarypack::unpack(data) {
            Ok(value) => {
                if let Some(peer_data) = value.get("__peerData") {
                    return if peer_data.get("type").and_then(Value::as_str) == Some("close") {
                        Incoming::Close
                    } else {
                        Incoming::Ignored
                    };
                }
                match value.get("text").and_then(Value::as_str) {
                    Some(text) => Incoming::Message {
                        text: text.to_string(),
                        name: value.get("name").and_then(Value::as_str).map(str::to_string),
                    },
                    None => Incoming::Ignored,
                }
            }
            Err(_) => Incoming::Ignored,
        },
        Serialization::Json | Serialization::Raw => {
            let Ok(value) = serde_json::from_slice::<serde_json::Value>(data) else {
                return Incoming::Ignored;
            };
            if value.pointer("/__peerData/type").and_then(serde_json::Value::as_str) == Some("close") {
                return Incoming::Close;
            }
            match value.get("text").and_then(serde_json::Value::as_str) {
                Some(text) => Incoming::Message {
                    text: text.to_string(),
                    name: value.get("name").and_then(serde_json::Value::as_str).map(str::to_string),
                },
                None => Incoming::Ignored,
            }
        }
    }
}

/// Bytes to send a `ChatMessage` on a connection. PeerJS reads every format from binary messages
/// (its JSON connection runs the payload through a TextDecoder), so nothing is sent as text.
pub fn encode(serialization: Serialization, message: &ChatMessage) -> Vec<u8> {
    match serialization {
        Serialization::Binary => binarypack::pack(&Value::Map(vec![
            (Value::Str("id".into()), Value::Str(message.id.clone())),
            (Value::Str("authorName".into()), Value::Str(message.author_name.clone())),
            (Value::Str("text".into()), Value::Str(message.text.clone())),
            (Value::Str("timestamp".into()), Value::Int(message.timestamp)),
            (Value::Str("isBroadcaster".into()), Value::Bool(message.is_broadcaster)),
        ])),
        Serialization::Json | Serialization::Raw => serde_json::to_vec(message).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_browser_viewer_message() {
        let bytes = binarypack::pack(&Value::Map(vec![
            (Value::Str("text".into()), Value::Str("  bom jogo  ".into())),
            (Value::Str("name".into()), Value::Nil),
        ]));
        assert_eq!(
            decode(Serialization::Binary, &bytes),
            Incoming::Message { text: "  bom jogo  ".into(), name: None }
        );
    }

    #[test]
    fn reads_an_android_viewer_message() {
        assert_eq!(
            decode(Serialization::Json, br#"{"text":"oi","name":"Ana"}"#),
            Incoming::Message { text: "oi".into(), name: Some("Ana".into()) }
        );
    }

    #[test]
    fn recognises_the_peerjs_close_message() {
        let bytes = binarypack::pack(&Value::Map(vec![(
            Value::Str("__peerData".into()),
            Value::Map(vec![(Value::Str("type".into()), Value::Str("close".into()))]),
        )]));
        assert_eq!(decode(Serialization::Binary, &bytes), Incoming::Close);
    }

    #[test]
    fn encodes_what_the_viewers_expect() {
        let message = ChatMessage::new("olá".into(), "Transmissor".into(), true);
        let value = binarypack::unpack(&encode(Serialization::Binary, &message)).unwrap();
        assert_eq!(value.get("text").and_then(Value::as_str), Some("olá"));
        assert_eq!(value.get("isBroadcaster"), Some(&Value::Bool(true)));
        let json: serde_json::Value = serde_json::from_slice(&encode(Serialization::Json, &message)).unwrap();
        assert_eq!(json["authorName"], "Transmissor");
    }

    #[test]
    fn encodes_byte_for_byte_like_peerjs() {
        // pack({ id: "m1", authorName: "Transmissor", text: "olá", timestamp: 1792639943123,
        // isBroadcaster: true }) with peerjs-js-binarypack 2.x.
        let message = ChatMessage {
            id: "m1".into(),
            author_name: "Transmissor".into(),
            text: "olá".into(),
            timestamp: 1_792_639_943_123,
            is_broadcaster: true,
        };
        let hex: String = encode(Serialization::Binary, &message).iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(
            hex,
            "85b26964b26d31ba617574686f724e616d65bb5472616e736d6973736f72b474657874b46f6cc3a1b974696d657374616d70d3000001a161aac1d3bd697342726f6164636173746572c3"
        );
    }

    #[test]
    fn names_and_text_follow_the_web_rules() {
        assert_eq!(sanitize_text("  oi  "), "oi");
        assert_eq!(sanitize_text(&"a".repeat(600)).len(), 500);
        assert_eq!(resolve_author_name(Some("   "), 3), "Espectador 3");
        assert_eq!(resolve_author_name(Some(" Bia "), 1), "Bia");
    }
}
