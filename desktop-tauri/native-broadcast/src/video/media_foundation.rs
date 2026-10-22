//! H.264 on the GPU through the hardware encoder MFTs Media Foundation lists (NVENC, AMD AMF,
//! Intel Quick Sync). Hardware MFTs are asynchronous: they ask for input (METransformNeedInput)
//! and announce output (METransformHaveOutput) as events, which a dedicated thread waits for.
//! Any failure is returned to the pipeline, which falls back to openh264.

use super::convert::{YuvFrame, YuvLayout};
use super::{EncodedFrame, EncoderInfo, FrameSink, H264Encoder};
use std::mem::ManuallyDrop;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use windows::core::{Interface, GUID, PWSTR};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::VARIANT;

// How long a frame may wait for the MFT to ask for input before the encoder counts as stuck.
const INPUT_TIMEOUT: Duration = Duration::from_millis(750);
// Frames sent with nothing coming back: the MFT accepted them but is not encoding.
const MAX_FRAMES_WITHOUT_OUTPUT: u32 = 30;

/// COM interfaces from the MTA, moved to the event thread (which joins the MTA too).
struct Mta<T>(T);
unsafe impl<T> Send for Mta<T> {}

#[derive(Default)]
struct Progress {
    input_credits: usize,
    frames_in: u32,
    frames_out: u32,
    failure: Option<String>,
    stopped: bool,
}

type Shared = Arc<(Mutex<Progress>, Condvar)>;

pub struct MediaFoundationEncoder {
    transform: IMFTransform,
    activate: IMFActivate,
    codec_api: Option<ICodecAPI>,
    progress: Shared,
    info: EncoderInfo,
    origin: Instant,
    frame_duration: i64,
}

// The MFT lives in the multithreaded apartment; the pipeline thread and the event thread both use it.
unsafe impl Send for MediaFoundationEncoder {}

fn pack(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | low as u64
}

fn hr(context: &str) -> impl Fn(windows::core::Error) -> String + '_ {
    move |error| format!("{context}: {error}")
}

unsafe fn friendly_name(activate: &IMFActivate) -> String {
    let mut name = PWSTR::null();
    let mut length = 0u32;
    if activate.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut name, &mut length).is_err() || name.is_null() {
        return "H.264 (GPU)".to_string();
    }
    let text = name.to_string().unwrap_or_default();
    CoTaskMemFree(Some(name.0 as *const _));
    text
}

/// The first hardware H.264 encoder that activates, in Media Foundation's preferred order.
unsafe fn activate_hardware_encoder() -> Result<(IMFTransform, IMFActivate, String), String> {
    let input = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 };
    let output = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
    let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    MFTEnumEx(
        MFT_CATEGORY_VIDEO_ENCODER,
        MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
        Some(&input),
        Some(&output),
        &mut activates,
        &mut count,
    )
    .map_err(hr("MFTEnumEx"))?;
    if activates.is_null() || count == 0 {
        return Err("no hardware H.264 encoder on this PC".to_string());
    }
    let mut chosen = None;
    let mut last_error = String::from("no hardware H.264 encoder activated");
    for slot in std::slice::from_raw_parts_mut(activates, count as usize) {
        let Some(activate) = slot.take() else { continue };
        if chosen.is_none() {
            let name = friendly_name(&activate);
            match activate.ActivateObject::<IMFTransform>() {
                Ok(transform) => chosen = Some((transform, activate, name)),
                Err(error) => last_error = format!("{name}: {error}"),
            }
        }
    }
    CoTaskMemFree(Some(activates as *const _));
    chosen.ok_or(last_error)
}

unsafe fn set_codec_value(api: &ICodecAPI, key: &GUID, value: VARIANT) {
    if let Err(error) = api.SetValue(key, &value) {
        log::debug!("encoder ignored a setting: {error}");
    }
}

unsafe fn video_type(subtype: &GUID, width: u32, height: u32, fps: u32) -> Result<IMFMediaType, String> {
    let media_type = MFCreateMediaType().map_err(hr("MFCreateMediaType"))?;
    media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(hr("major type"))?;
    media_type.SetGUID(&MF_MT_SUBTYPE, subtype).map_err(hr("subtype"))?;
    media_type.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height)).map_err(hr("frame size"))?;
    media_type.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)).map_err(hr("frame rate"))?;
    media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1)).map_err(hr("aspect ratio"))?;
    media_type
        .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
        .map_err(hr("interlace mode"))?;
    Ok(media_type)
}

/// Whether an Annex B access unit carries its own SPS (NAL type 7).
fn has_sps(data: &[u8]) -> bool {
    data.windows(4).any(|window| window[0] == 0 && window[1] == 0 && window[2] == 1 && window[3] & 0x1f == 7)
}

struct Output {
    transform: IMFTransform,
    provides_samples: bool,
    sample_size: u32,
    sequence_header: Option<Vec<u8>>,
    origin: Instant,
    sink: FrameSink,
}

impl Output {
    unsafe fn refresh_sequence_header(&mut self) {
        let Ok(media_type) = self.transform.GetOutputCurrentType(0) else { return };
        let Ok(size) = media_type.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) else { return };
        let mut blob = vec![0u8; size as usize];
        if media_type.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut blob, None).is_ok() {
            self.sequence_header = Some(blob);
        }
    }

    unsafe fn pull(&mut self) -> Result<bool, String> {
        loop {
            let sample = if self.provides_samples {
                None
            } else {
                let sample = MFCreateSample().map_err(hr("MFCreateSample"))?;
                let buffer = MFCreateMemoryBuffer(self.sample_size.max(1 << 20)).map_err(hr("MFCreateMemoryBuffer"))?;
                sample.AddBuffer(&buffer).map_err(hr("AddBuffer"))?;
                Some(sample)
            };
            let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: ManuallyDrop::new(sample),
                dwStatus: 0,
                pEvents: ManuallyDrop::new(None),
            }];
            let mut status = 0u32;
            let result = self.transform.ProcessOutput(0, &mut buffers, &mut status);
            let sample = ManuallyDrop::take(&mut buffers[0].pSample);
            drop(ManuallyDrop::take(&mut buffers[0].pEvents));
            match result {
                Ok(()) => {
                    if let Some(sample) = sample {
                        self.emit(&sample)?;
                    }
                    return Ok(true);
                }
                Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(false),
                Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                    let media_type = self.transform.GetOutputAvailableType(0, 0).map_err(hr("output type"))?;
                    self.transform.SetOutputType(0, &media_type, 0).map_err(hr("SetOutputType"))?;
                    self.refresh_sequence_header();
                }
                Err(error) => return Err(format!("ProcessOutput: {error}")),
            }
        }
    }

    unsafe fn emit(&mut self, sample: &IMFSample) -> Result<(), String> {
        let buffer = sample.ConvertToContiguousBuffer().map_err(hr("ConvertToContiguousBuffer"))?;
        let mut pointer = std::ptr::null_mut();
        let mut length = 0u32;
        buffer.Lock(&mut pointer, None, Some(&mut length)).map_err(hr("Lock"))?;
        let mut data = std::slice::from_raw_parts(pointer, length as usize).to_vec();
        let _ = buffer.Unlock();
        if data.is_empty() {
            return Ok(());
        }
        let keyframe = sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) != 0;
        // Some encoders keep SPS/PPS only in the media type; a viewer joining needs them in-band.
        if keyframe && !has_sps(&data) {
            if self.sequence_header.is_none() {
                self.refresh_sequence_header();
            }
            if let Some(header) = &self.sequence_header {
                data.splice(0..0, header.iter().copied());
            }
        }
        let time = sample.GetSampleTime().unwrap_or(0).max(0) as u64;
        (self.sink)(EncodedFrame {
            data: bytes::Bytes::from(data),
            keyframe,
            captured_at: self.origin + Duration::from_nanos(time * 100),
        });
        Ok(())
    }
}

fn fail(progress: &Shared, message: String) {
    let (state, wake) = &**progress;
    if let Ok(mut state) = state.lock() {
        state.failure.get_or_insert(message);
        wake.notify_all();
    }
}

impl MediaFoundationEncoder {
    pub fn new(width: u32, height: u32, fps: u32, bitrate: u32, sink: FrameSink) -> Result<Self, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(hr("MFStartup"))?;
            let (transform, activate, name) = activate_hardware_encoder()?;
            match Self::configure(transform.clone(), activate.clone(), name, width, height, fps, bitrate, sink) {
                Ok(encoder) => Ok(encoder),
                Err(error) => {
                    let _ = activate.ShutdownObject();
                    let _ = MFShutdown();
                    Err(error)
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn configure(
        transform: IMFTransform,
        activate: IMFActivate,
        name: String,
        width: u32,
        height: u32,
        fps: u32,
        bitrate: u32,
        sink: FrameSink,
    ) -> Result<Self, String> {
        let attributes = transform.GetAttributes().map_err(hr("GetAttributes"))?;
        if attributes.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) == 0 {
            return Err(format!("{name} is not an asynchronous MFT"));
        }
        attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1).map_err(hr("MF_TRANSFORM_ASYNC_UNLOCK"))?;
        let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);

        let codec_api: Option<ICodecAPI> = transform.cast().ok();
        if let Some(api) = &codec_api {
            set_codec_value(api, &CODECAPI_AVEncCommonRateControlMode, VARIANT::from(eAVEncCommonRateControlMode_CBR.0 as u32));
            set_codec_value(api, &CODECAPI_AVEncCommonMeanBitRate, VARIANT::from(bitrate));
            set_codec_value(api, &CODECAPI_AVLowLatencyMode, VARIANT::from(true));
            set_codec_value(api, &CODECAPI_AVEncMPVDefaultBPictureCount, VARIANT::from(0u32));
            set_codec_value(api, &CODECAPI_AVEncMPVGOPSize, VARIANT::from(fps * 10));
        }

        // Baseline is what every viewer negotiates; an encoder without it gets the closest profile
        // it accepts (decoders handle them all) rather than losing the GPU.
        let mut last_error = String::new();
        let mut accepted = false;
        for profile in [eAVEncH264VProfile_Base, eAVEncH264VProfile_ConstrainedBase, eAVEncH264VProfile_Main] {
            let output_type = video_type(&MFVideoFormat_H264, width, height, fps)?;
            output_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(hr("bitrate"))?;
            output_type.SetUINT32(&MF_MT_MPEG2_PROFILE, profile.0 as u32).map_err(hr("profile"))?;
            match transform.SetOutputType(0, &output_type, 0) {
                Ok(()) => {
                    accepted = true;
                    break;
                }
                Err(error) => last_error = format!("SetOutputType: {error}"),
            }
        }
        if !accepted {
            return Err(last_error);
        }
        let input_type = video_type(&MFVideoFormat_NV12, width, height, fps)?;
        transform.SetInputType(0, &input_type, 0).map_err(hr("SetInputType"))?;

        let stream_info = transform.GetOutputStreamInfo(0).map_err(hr("GetOutputStreamInfo"))?;
        let provides_samples = stream_info.dwFlags
            & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0 as u32)
            != 0;
        let origin = Instant::now();
        let progress: Shared = Arc::new((Mutex::new(Progress::default()), Condvar::new()));
        let generator: IMFMediaEventGenerator = transform.cast().map_err(hr("IMFMediaEventGenerator"))?;

        transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0).map_err(hr("flush"))?;
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0).map_err(hr("begin streaming"))?;
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0).map_err(hr("start of stream"))?;

        let output = Output {
            transform: transform.clone(),
            provides_samples,
            sample_size: stream_info.cbSize,
            sequence_header: None,
            origin,
            sink,
        };
        let events = Mta(generator);
        let thread_progress = progress.clone();
        let output = Mta(output);
        std::thread::Builder::new()
            .name("p2pcast-mft-events".to_string())
            .spawn(move || {
                // Whole wrappers, not their fields: closures capture fields precisely.
                let events = events;
                let mut output = output;
                let output = &mut output.0;
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                loop {
                    // Returns MF_E_SHUTDOWN once the encoder is dropped.
                    let event = match events.0.GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0)) {
                        Ok(event) => event,
                        Err(_) => break,
                    };
                    let kind = event.GetType().unwrap_or(0);
                    if kind == METransformNeedInput.0 as u32 {
                        let (state, wake) = &*thread_progress;
                        if let Ok(mut state) = state.lock() {
                            state.input_credits += 1;
                            wake.notify_all();
                        }
                    } else if kind == METransformHaveOutput.0 as u32 {
                        match output.pull() {
                            Ok(true) => {
                                if let Ok(mut state) = thread_progress.0.lock() {
                                    state.frames_out += 1;
                                }
                            }
                            Ok(false) => {}
                            Err(error) => {
                                fail(&thread_progress, error);
                                break;
                            }
                        }
                    } else if kind == MEError.0 as u32 {
                        fail(&thread_progress, "the hardware encoder reported an error".to_string());
                        break;
                    }
                    if thread_progress.0.lock().map_or(true, |state| state.stopped) {
                        break;
                    }
                }
            })
            .map_err(|error| format!("could not start the encoder event thread: {error}"))?;

        Ok(Self {
            transform,
            activate,
            codec_api,
            progress,
            info: EncoderInfo { name: format!("{name} (GPU)"), hardware: true, width, height, fps, bitrate },
            origin,
            frame_duration: 10_000_000 / fps.max(1) as i64,
        })
    }

    unsafe fn input_sample(&self, frame: &YuvFrame, captured_at: Instant) -> Result<IMFSample, String> {
        let length = frame.data.len() as u32;
        let buffer = MFCreateMemoryBuffer(length).map_err(hr("MFCreateMemoryBuffer"))?;
        let mut pointer = std::ptr::null_mut();
        buffer.Lock(&mut pointer, None, None).map_err(hr("Lock"))?;
        std::ptr::copy_nonoverlapping(frame.data.as_ptr(), pointer, frame.data.len());
        let _ = buffer.Unlock();
        buffer.SetCurrentLength(length).map_err(hr("SetCurrentLength"))?;
        let sample = MFCreateSample().map_err(hr("MFCreateSample"))?;
        sample.AddBuffer(&buffer).map_err(hr("AddBuffer"))?;
        let time = captured_at.saturating_duration_since(self.origin).as_nanos() as i64 / 100;
        sample.SetSampleTime(time).map_err(hr("SetSampleTime"))?;
        sample.SetSampleDuration(self.frame_duration).map_err(hr("SetSampleDuration"))?;
        Ok(sample)
    }
}

impl H264Encoder for MediaFoundationEncoder {
    fn info(&self) -> EncoderInfo {
        self.info.clone()
    }

    fn layout(&self) -> YuvLayout {
        YuvLayout::Nv12
    }

    fn encode(&mut self, frame: &YuvFrame, captured_at: Instant, keyframe: bool) -> Result<(), String> {
        {
            let (state, wake) = &*self.progress;
            let mut state = state.lock().map_err(|_| "encoder state is unavailable".to_string())?;
            let deadline = Instant::now() + INPUT_TIMEOUT;
            while state.input_credits == 0 && state.failure.is_none() {
                let now = Instant::now();
                if now >= deadline {
                    return Err(format!("{} stopped asking for frames", self.info.name));
                }
                state = wake.wait_timeout(state, deadline - now).map_err(|_| "encoder state is unavailable".to_string())?.0;
            }
            if let Some(failure) = state.failure.take() {
                return Err(failure);
            }
            if state.frames_in >= MAX_FRAMES_WITHOUT_OUTPUT && state.frames_out == 0 {
                return Err(format!("{} accepted frames but produced no video", self.info.name));
            }
            state.input_credits -= 1;
            state.frames_in += 1;
        }
        unsafe {
            if keyframe {
                if let Some(api) = &self.codec_api {
                    set_codec_value(api, &CODECAPI_AVEncVideoForceKeyFrame, VARIANT::from(1u32));
                }
            }
            let sample = self.input_sample(frame, captured_at)?;
            self.transform.ProcessInput(0, &sample, 0).map_err(hr("ProcessInput"))
        }
    }
}

impl Drop for MediaFoundationEncoder {
    fn drop(&mut self) {
        if let Ok(mut state) = self.progress.0.lock() {
            state.stopped = true;
        }
        unsafe {
            // Wakes the event thread (GetEvent fails from now on), which then exits on its own.
            if let Ok(shutdown) = self.transform.cast::<IMFShutdown>() {
                let _ = shutdown.Shutdown();
            }
            let _ = self.activate.ShutdownObject();
            let _ = MFShutdown();
        }
    }
}
