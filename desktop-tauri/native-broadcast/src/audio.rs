//! Audio: 48 kHz stereo float PCM from the capture helper, encoded once to 20 ms Opus frames.
//! Encoding a frame takes well under a millisecond, so it runs on the thread that reads the PCM.

use std::sync::{Arc, Mutex};

pub(crate) const SAMPLE_RATE: u32 = 48_000;
pub(crate) const FRAME_SAMPLES: usize = 960; // 20 ms per channel
const CHANNELS: usize = 2;
const BITRATE: i32 = 128_000;

pub(crate) struct EncodedAudio {
    pub data: bytes::Bytes,
    /// Position of the frame's first sample since the live started, in 48 kHz samples.
    pub sample_index: u64,
}

pub(crate) type AudioSink = Arc<dyn Fn(EncodedAudio) + Send + Sync>;

struct State {
    encoder: opus::Encoder,
    pending: Vec<f32>,
    sample_index: u64,
    muted: bool,
    sink: AudioSink,
    packet: Vec<u8>,
}

/// Where the capture hands its PCM.
#[derive(Clone)]
pub struct AudioInput(Arc<Mutex<State>>);

impl AudioInput {
    pub(crate) fn new(sink: AudioSink) -> Result<Self, String> {
        let mut encoder = opus::Encoder::new(SAMPLE_RATE, opus::Channels::Stereo, opus::Application::Audio)
            .map_err(|error| format!("Opus: {error}"))?;
        encoder.set_bitrate(opus::Bitrate::Bits(BITRATE)).map_err(|error| format!("Opus: {error}"))?;
        // Loss shows up as Opus's own concealment instead of clicks.
        let _ = encoder.set_inband_fec(true);
        let _ = encoder.set_packet_loss_perc(5);
        Ok(Self(Arc::new(Mutex::new(State {
            encoder,
            pending: Vec::with_capacity(FRAME_SAMPLES * CHANNELS * 4),
            sample_index: 0,
            muted: false,
            sink,
            packet: vec![0; 4000],
        }))))
    }

    /// Interleaved stereo samples, any amount at a time.
    pub fn push_interleaved(&self, samples: &[f32]) {
        let Ok(mut state) = self.0.lock() else { return };
        state.pending.extend_from_slice(samples);
        let frame_len = FRAME_SAMPLES * CHANNELS;
        let mut offset = 0;
        while state.pending.len() - offset >= frame_len {
            let state = &mut *state;
            let input = &mut state.pending[offset..offset + frame_len];
            if state.muted {
                input.fill(0.0);
            }
            match state.encoder.encode_float(input, &mut state.packet) {
                Ok(length) => (state.sink)(EncodedAudio {
                    data: bytes::Bytes::copy_from_slice(&state.packet[..length]),
                    sample_index: state.sample_index,
                }),
                Err(error) => log::warn!("dropped an audio frame: {error}"),
            }
            state.sample_index += FRAME_SAMPLES as u64;
            offset += frame_len;
        }
        state.pending.drain(..offset);
    }

    pub(crate) fn set_muted(&self, muted: bool) {
        if let Ok(mut state) = self.0.lock() {
            state.muted = muted;
        }
    }
}
