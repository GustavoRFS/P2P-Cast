//! Software H.264 with Cisco's openh264, built from source: the fallback when the GPU has no
//! encoder Media Foundation can drive, and the encoder the Linux test host uses.

use super::convert::{YuvFrame, YuvLayout};
use super::{EncodedFrame, EncoderInfo, FrameSink, H264Encoder};
use openh264::encoder::{BitRate, Encoder, EncoderConfig, FrameRate, FrameType, IntraFramePeriod, RateControlMode, UsageType};
use openh264::formats::YUVSlices;
use openh264::OpenH264API;
use std::time::Instant;

pub struct OpenH264 {
    encoder: Encoder,
    info: EncoderInfo,
    sink: FrameSink,
    buffer: Vec<u8>,
}

impl OpenH264 {
    pub fn new(width: u32, height: u32, fps: u32, bitrate: u32, sink: FrameSink) -> Result<Self, String> {
        let threads = std::thread::available_parallelism().map_or(2, |count| count.get()).clamp(1, 4) as u16;
        let config = EncoderConfig::new()
            .bitrate(BitRate::from_bps(bitrate))
            .max_frame_rate(FrameRate::from_hz(fps as f32))
            .usage_type(UsageType::CameraVideoRealTime)
            .rate_control_mode(RateControlMode::Bitrate)
            .skip_frames(false)
            .intra_frame_period(IntraFramePeriod::from_num_frames(fps * 10))
            .num_threads(threads);
        let encoder = Encoder::with_api_config(OpenH264API::from_source(), config)
            .map_err(|error| format!("openh264: {error}"))?;
        Ok(Self {
            encoder,
            info: EncoderInfo {
                name: "openh264 (CPU)".to_string(),
                hardware: false,
                width,
                height,
                fps,
                bitrate,
            },
            sink,
            buffer: Vec::new(),
        })
    }
}

impl H264Encoder for OpenH264 {
    fn info(&self) -> EncoderInfo {
        self.info.clone()
    }

    fn layout(&self) -> YuvLayout {
        YuvLayout::I420
    }

    fn encode(&mut self, frame: &YuvFrame, captured_at: Instant, keyframe: bool) -> Result<(), String> {
        if keyframe {
            self.encoder.force_intra_frame();
        }
        let width = frame.width as usize;
        let source = YUVSlices::new(frame.planes(), (width, frame.height as usize), (width, width / 2, width / 2));
        let bitstream = self.encoder.encode(&source).map_err(|error| format!("openh264: {error}"))?;
        let frame_type = bitstream.frame_type();
        if matches!(frame_type, FrameType::Skip | FrameType::Invalid) {
            return Ok(());
        }
        self.buffer.clear();
        bitstream.write_vec(&mut self.buffer);
        if self.buffer.is_empty() {
            return Ok(());
        }
        (self.sink)(EncodedFrame {
            data: bytes::Bytes::copy_from_slice(&self.buffer),
            keyframe: matches!(frame_type, FrameType::IDR | FrameType::I),
            captured_at,
        });
        Ok(())
    }
}
