//! A test broadcaster with a synthetic picture (moving bars) and a 440 Hz tone, encoded with
//! openh264 so it runs anywhere. Prints one JSON line per event; reads `chat <text>` and `quit`
//! from stdin. Environment: P2PCAST_ID (broadcast id), P2PCAST_STILL_AFTER (seconds of motion
//! before the picture freezes, the way a WGC capture of an unchanging window goes quiet).
//!
//!     cargo run --release --example synthetic

use p2pcast_native_broadcast::{BroadcastConfig, BroadcastEvent, ChatMessage, EncoderPreference, NativeBroadcast, VideoSettings};
use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const WIDTH: u32 = 1280;
const HEIGHT: u32 = 720;
const FPS: u32 = 30;

fn print(value: serde_json::Value) {
    println!("{value}");
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let still_after = std::env::var("P2PCAST_STILL_AFTER").ok().and_then(|value| value.parse::<u64>().ok());
    let events = Arc::new(|event: BroadcastEvent| print(serde_json::json!({ "event": event })));
    let config = BroadcastConfig::p2pcast(
        std::env::var("P2PCAST_ID").ok(),
        VideoSettings { max_width: 1920, max_height: 1080, fps: FPS, bitrate: Some(3_000_000), encoder: EncoderPreference::Software },
    );
    let broadcast = match NativeBroadcast::start(config, events).await {
        Ok(broadcast) => Arc::new(broadcast),
        Err(error) => {
            print(serde_json::json!({ "error": error }));
            std::process::exit(1);
        }
    };
    print(serde_json::json!({ "ready": broadcast.peer_id() }));
    let running = Arc::new(AtomicBool::new(true));

    let video = broadcast.video_input();
    let video_running = running.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut frame_index = 0u64;
        while video_running.load(Ordering::Relaxed) {
            let moving = still_after.map_or(true, |seconds| started.elapsed() < Duration::from_secs(seconds));
            if moving {
                let mut rgba = video.buffer((WIDTH * HEIGHT * 4) as usize);
                let offset = (frame_index * 8) as u32 % WIDTH;
                for (index, pixel) in rgba.chunks_exact_mut(4).enumerate() {
                    let x = index as u32 % WIDTH;
                    let y = index as u32 / WIDTH;
                    let band = ((x + offset) / 80) % 4;
                    let shade = (y * 255 / HEIGHT) as u8;
                    let color = match band {
                        0 => [230, 40, 40],
                        1 => [40, 200, 80],
                        2 => [40, 90, 230],
                        _ => [shade, shade, shade],
                    };
                    pixel.copy_from_slice(&[color[0], color[1], color[2], 255]);
                }
                video.push_rgba(WIDTH, HEIGHT, rgba);
                frame_index += 1;
            }
            std::thread::sleep(Duration::from_millis(1000 / FPS as u64));
        }
    });

    let audio = broadcast.audio_input();
    let audio_running = running.clone();
    std::thread::spawn(move || {
        let mut phase = 0f32;
        let step = 440.0 * std::f32::consts::TAU / 48_000.0;
        let started = Instant::now();
        let mut sent = 0u64;
        while audio_running.load(Ordering::Relaxed) {
            // Real time, in 10 ms chunks like the WASAPI helper.
            let due = (started.elapsed().as_secs_f64() * 48_000.0) as u64;
            let mut samples = Vec::new();
            while sent < due {
                let value = phase.sin() * 0.2;
                phase = (phase + step) % std::f32::consts::TAU;
                samples.extend_from_slice(&[value, value]);
                sent += 1;
            }
            audio.push_interleaved(&samples);
            std::thread::sleep(Duration::from_millis(10));
        }
    });

    let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });
    while let Some(line) = line_rx.recv().await {
        if let Some(text) = line.strip_prefix("chat ") {
            broadcast.send_chat(&ChatMessage::new(text.to_string(), "Transmissor".to_string(), true));
        } else if line.trim() == "quit" {
            break;
        }
    }
    running.store(false, Ordering::Relaxed);
    broadcast.stop();
    print(serde_json::json!({ "stopped": true }));
}
