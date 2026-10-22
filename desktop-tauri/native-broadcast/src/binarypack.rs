//! BinaryPack, the wire format of PeerJS data connections that do not ask for JSON (the browser
//! viewers' chat). A port of peerjs-js-binarypack 2.x for the values a chat message uses; the tag
//! layout is msgpack-like but not msgpack (strings and raw bytes swap places, for one).

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Nil,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Bin(Vec<u8>),
    Array(Vec<Value>),
    Map(Vec<(Value, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Map(entries) => entries
                .iter()
                .find(|(entry_key, _)| matches!(entry_key, Value::Str(name) if name == key))
                .map(|(_, value)| value),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(text) => Some(text),
            _ => None,
        }
    }
}

pub fn pack(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    pack_into(value, &mut out);
    out
}

fn pack_len(out: &mut Vec<u8>, length: usize, fix: u8, tag16: u8, tag32: u8) {
    if length <= 0x0f {
        out.push(fix + length as u8);
    } else if length <= 0xffff {
        out.push(tag16);
        out.extend_from_slice(&(length as u16).to_be_bytes());
    } else {
        out.push(tag32);
        out.extend_from_slice(&(length as u32).to_be_bytes());
    }
}

fn pack_into(value: &Value, out: &mut Vec<u8>) {
    match value {
        Value::Nil => out.push(0xc0),
        Value::Bool(true) => out.push(0xc3),
        Value::Bool(false) => out.push(0xc2),
        Value::Int(number) => pack_integer(*number, out),
        Value::Float(number) => {
            out.push(0xcb);
            out.extend_from_slice(&number.to_be_bytes());
        }
        Value::Str(text) => {
            pack_len(out, text.len(), 0xb0, 0xd8, 0xd9);
            out.extend_from_slice(text.as_bytes());
        }
        Value::Bin(bytes) => {
            pack_len(out, bytes.len(), 0xa0, 0xda, 0xdb);
            out.extend_from_slice(bytes);
        }
        Value::Array(items) => {
            pack_len(out, items.len(), 0x90, 0xdc, 0xdd);
            items.iter().for_each(|item| pack_into(item, out));
        }
        Value::Map(entries) => {
            pack_len(out, entries.len(), 0x80, 0xde, 0xdf);
            for (key, item) in entries {
                pack_into(key, out);
                pack_into(item, out);
            }
        }
    }
}

// Same order of checks as the JS packer, so both sides produce identical bytes.
fn pack_integer(number: i64, out: &mut Vec<u8>) {
    if (-32..=0x7f).contains(&number) {
        out.push(number as u8);
    } else if (0..=0xff).contains(&number) {
        out.push(0xcc);
        out.push(number as u8);
    } else if (-128..=0x7f).contains(&number) {
        out.push(0xd0);
        out.push(number as i8 as u8);
    } else if (0..=0xffff).contains(&number) {
        out.push(0xcd);
        out.extend_from_slice(&(number as u16).to_be_bytes());
    } else if (-32768..=0x7fff).contains(&number) {
        out.push(0xd1);
        out.extend_from_slice(&(number as i16).to_be_bytes());
    } else if (0..=0xffff_ffff).contains(&number) {
        out.push(0xce);
        out.extend_from_slice(&(number as u32).to_be_bytes());
    } else if (-2_147_483_648..=0x7fff_ffff).contains(&number) {
        out.push(0xd2);
        out.extend_from_slice(&(number as i32).to_be_bytes());
    } else {
        out.push(0xd3);
        out.extend_from_slice(&number.to_be_bytes());
    }
}

pub fn unpack(bytes: &[u8]) -> Result<Value, String> {
    let mut reader = Reader { bytes, index: 0 };
    reader.value(0)
}

struct Reader<'a> {
    bytes: &'a [u8],
    index: usize,
}

const MAX_DEPTH: usize = 32;

impl Reader<'_> {
    fn take(&mut self, length: usize) -> Result<&[u8], String> {
        let end = self
            .index
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or("BinaryPack: truncated value")?;
        let slice = &self.bytes[self.index..end];
        self.index = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn uint(&mut self, width: usize) -> Result<u64, String> {
        Ok(self.take(width)?.iter().fold(0u64, |acc, byte| (acc << 8) | *byte as u64))
    }

    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > MAX_DEPTH {
            return Err("BinaryPack: nested too deep".to_string());
        }
        let tag = self.u8()?;
        match tag {
            0x00..=0x7f => return Ok(Value::Int(tag as i64)),
            0xe0..=0xff => return Ok(Value::Int(tag as i64 - 0x100)),
            0xa0..=0xaf => return self.bin((tag - 0xa0) as usize),
            0xb0..=0xbf => return self.str((tag - 0xb0) as usize),
            0x90..=0x9f => return self.array((tag - 0x90) as usize, depth),
            0x80..=0x8f => return self.map((tag - 0x80) as usize, depth),
            _ => {}
        }
        match tag {
            0xc0 | 0xc1 | 0xd4..=0xd7 => Ok(Value::Nil),
            0xc2 => Ok(Value::Bool(false)),
            0xc3 => Ok(Value::Bool(true)),
            0xca => Ok(Value::Float(f32::from_bits(self.uint(4)? as u32) as f64)),
            0xcb => Ok(Value::Float(f64::from_bits(self.uint(8)?))),
            0xcc => Ok(Value::Int(self.uint(1)? as i64)),
            0xcd => Ok(Value::Int(self.uint(2)? as i64)),
            0xce => Ok(Value::Int(self.uint(4)? as i64)),
            0xcf => {
                let number = self.uint(8)?;
                Ok(i64::try_from(number).map_or(Value::Float(number as f64), Value::Int))
            }
            0xd0 => Ok(Value::Int(self.uint(1)? as u8 as i8 as i64)),
            0xd1 => Ok(Value::Int(self.uint(2)? as u16 as i16 as i64)),
            0xd2 => Ok(Value::Int(self.uint(4)? as u32 as i32 as i64)),
            0xd3 => Ok(Value::Int(self.uint(8)? as i64)),
            0xd8 => {
                let length = self.uint(2)? as usize;
                self.str(length)
            }
            0xd9 => {
                let length = self.uint(4)? as usize;
                self.str(length)
            }
            0xda => {
                let length = self.uint(2)? as usize;
                self.bin(length)
            }
            0xdb => {
                let length = self.uint(4)? as usize;
                self.bin(length)
            }
            0xdc => {
                let length = self.uint(2)? as usize;
                self.array(length, depth)
            }
            0xdd => {
                let length = self.uint(4)? as usize;
                self.array(length, depth)
            }
            0xde => {
                let length = self.uint(2)? as usize;
                self.map(length, depth)
            }
            0xdf => {
                let length = self.uint(4)? as usize;
                self.map(length, depth)
            }
            _ => Err(format!("BinaryPack: unknown tag {tag:#04x}")),
        }
    }

    fn str(&mut self, length: usize) -> Result<Value, String> {
        Ok(Value::Str(String::from_utf8_lossy(self.take(length)?).into_owned()))
    }

    fn bin(&mut self, length: usize) -> Result<Value, String> {
        Ok(Value::Bin(self.take(length)?.to_vec()))
    }

    fn array(&mut self, length: usize, depth: usize) -> Result<Value, String> {
        // Each element takes at least a byte, so a bogus length cannot allocate much.
        let mut items = Vec::with_capacity(length.min(self.bytes.len() - self.index));
        for _ in 0..length {
            items.push(self.value(depth + 1)?);
        }
        Ok(Value::Array(items))
    }

    fn map(&mut self, length: usize, depth: usize) -> Result<Value, String> {
        let mut entries = Vec::with_capacity(length.min(self.bytes.len() - self.index));
        for _ in 0..length {
            let key = self.value(depth + 1)?;
            let item = self.value(depth + 1)?;
            entries.push((key, item));
        }
        Ok(Value::Map(entries))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(entries: Vec<(&str, Value)>) -> Value {
        Value::Map(entries.into_iter().map(|(key, value)| (Value::Str(key.to_string()), value)).collect())
    }

    #[test]
    fn packs_a_viewer_message_like_the_js_packer() {
        // pack({ text: "oi", name: undefined }) in peerjs-js-binarypack.
        let value = map(vec![("text", Value::Str("oi".into())), ("name", Value::Nil)]);
        assert_eq!(
            pack(&value),
            [&[0x82, 0xb4][..], b"text", &[0xb2], b"oi", &[0xb4], b"name", &[0xc0]].concat()
        );
    }

    #[test]
    fn integers_take_the_js_tags() {
        assert_eq!(pack(&Value::Int(5)), vec![0x05]);
        assert_eq!(pack(&Value::Int(-1)), vec![0xff]);
        assert_eq!(pack(&Value::Int(200)), vec![0xcc, 200]);
        assert_eq!(pack(&Value::Int(-100)), vec![0xd0, 0x9c]);
        assert_eq!(pack(&Value::Int(1_000)), vec![0xcd, 0x03, 0xe8]);
        // A millisecond timestamp, as in ChatMessage.timestamp.
        assert_eq!(pack(&Value::Int(1_792_639_943_000))[0], 0xd3);
    }

    #[test]
    fn round_trips_a_chat_message() {
        let value = map(vec![
            ("id", Value::Str("6f1c2b8e-1d2e-4f3a-9b8c-7d6e5f4a3b2c".into())),
            ("authorName", Value::Str("Transmissor".into())),
            ("text", Value::Str("olá, mundo! ".repeat(20))),
            ("timestamp", Value::Int(1_792_639_943_123)),
            ("isBroadcaster", Value::Bool(true)),
        ]);
        let decoded = unpack(&pack(&value)).unwrap();
        assert_eq!(decoded, value);
        assert_eq!(decoded.get("authorName").and_then(Value::as_str), Some("Transmissor"));
    }

    #[test]
    fn rejects_truncated_input() {
        assert!(unpack(&[0xb5, b'a']).is_err());
        assert!(unpack(&[0xdf, 0xff, 0xff, 0xff, 0xff]).is_err());
    }
}
