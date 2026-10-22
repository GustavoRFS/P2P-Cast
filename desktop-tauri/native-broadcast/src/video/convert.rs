//! RGBA (what the WGC helper delivers) to the planar YUV encoders take, scaling down on the way when
//! the window is larger than the profile's resolution. BT.601 limited range, the matrix libwebrtc
//! and Chrome's canvas capture use, so colors match what viewers saw from the browser pipeline.

use fast_image_resize::{images::Image, images::ImageRef, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YuvLayout {
    /// Y, then U, then V planes (openh264).
    I420,
    /// Y, then interleaved UV (Media Foundation hardware encoders).
    #[cfg_attr(not(windows), allow(dead_code))]
    Nv12,
}

pub struct YuvFrame {
    pub width: u32,
    pub height: u32,
    pub layout: YuvLayout,
    pub data: Vec<u8>,
}

impl YuvFrame {
    pub fn new(width: u32, height: u32, layout: YuvLayout) -> Self {
        let luma = width as usize * height as usize;
        Self { width, height, layout, data: vec![0; luma + luma / 2] }
    }

    pub fn luma_len(&self) -> usize {
        self.width as usize * self.height as usize
    }

    /// (Y, U, V) for an I420 frame.
    pub fn planes(&self) -> (&[u8], &[u8], &[u8]) {
        let luma = self.luma_len();
        let chroma = luma / 4;
        (&self.data[..luma], &self.data[luma..luma + chroma], &self.data[luma + chroma..])
    }
}

/// Largest even size that fits `max` (0 = no limit) without upscaling, keeping the aspect ratio.
pub fn target_size(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    let mut scale = 1.0f64;
    if max_width > 0 {
        scale = scale.min(max_width as f64 / width as f64);
    }
    if max_height > 0 {
        scale = scale.min(max_height as f64 / height as f64);
    }
    let even = |value: f64| ((value as u32) & !1).max(2);
    (even(width as f64 * scale), even(height as f64 * scale))
}

#[derive(Default)]
pub struct Converter {
    resizer: Resizer,
    scaled: Vec<u8>,
}

impl Converter {
    pub fn convert(&mut self, rgba: &[u8], width: u32, height: u32, out: &mut YuvFrame) -> Result<(), String> {
        if rgba.len() != width as usize * height as usize * 4 {
            return Err("frame size does not match its dimensions".to_string());
        }
        let source = if (width, height) == (out.width, out.height) {
            rgba
        } else {
            let source = ImageRef::new(width, height, rgba, PixelType::U8x4).map_err(|error| error.to_string())?;
            let mut buffer = std::mem::take(&mut self.scaled);
            buffer.resize(out.width as usize * out.height as usize * 4, 0);
            let mut scaled = Image::from_vec_u8(out.width, out.height, buffer, PixelType::U8x4)
                .map_err(|error| error.to_string())?;
            self.resizer
                .resize(
                    &source,
                    &mut scaled,
                    &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Bilinear)),
                )
                .map_err(|error| error.to_string())?;
            self.scaled = scaled.into_vec();
            &self.scaled
        };
        rgba_to_yuv(source, out);
        Ok(())
    }
}

fn rgba_to_yuv(rgba: &[u8], out: &mut YuvFrame) {
    let width = out.width as usize;
    let height = out.height as usize;
    let luma = width * height;
    let (y_plane, chroma) = out.data.split_at_mut(luma);
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get()).clamp(1, 4);
    // Bands of whole row pairs, so each 2×2 chroma block stays inside one band.
    let pairs = height / 2;
    let band_pairs = pairs.div_ceil(threads).max(1);
    let layout = out.layout;
    std::thread::scope(|scope| {
        let mut y_rest = &mut *y_plane;
        let (mut u_rest, mut v_rest): (&mut [u8], &mut [u8]) = match layout {
            YuvLayout::I420 => {
                let (u, v) = chroma.split_at_mut(luma / 4);
                (u, v)
            }
            YuvLayout::Nv12 => (chroma, &mut []),
        };
        let mut first_pair = 0;
        while first_pair < pairs {
            let count = band_pairs.min(pairs - first_pair);
            let (y_band, y_next) = std::mem::take(&mut y_rest).split_at_mut(count * 2 * width);
            y_rest = y_next;
            let rgba_band = &rgba[first_pair * 2 * width * 4..(first_pair + count) * 2 * width * 4];
            match layout {
                YuvLayout::I420 => {
                    let half = width / 2 * count;
                    let (u_band, u_next) = std::mem::take(&mut u_rest).split_at_mut(half);
                    let (v_band, v_next) = std::mem::take(&mut v_rest).split_at_mut(half);
                    u_rest = u_next;
                    v_rest = v_next;
                    scope.spawn(move || convert_band(rgba_band, width, count, y_band, Chroma::Planar(u_band, v_band)));
                }
                YuvLayout::Nv12 => {
                    let (uv_band, uv_next) = std::mem::take(&mut u_rest).split_at_mut(width * count);
                    u_rest = uv_next;
                    scope.spawn(move || convert_band(rgba_band, width, count, y_band, Chroma::Interleaved(uv_band)));
                }
            }
            first_pair += count;
        }
    });
}

enum Chroma<'a> {
    Planar(&'a mut [u8], &'a mut [u8]),
    Interleaved(&'a mut [u8]),
}

#[inline(always)]
fn luma(r: i32, g: i32, b: i32) -> u8 {
    (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8
}

fn convert_band(rgba: &[u8], width: usize, pairs: usize, y: &mut [u8], mut chroma: Chroma<'_>) {
    let half = width / 2;
    for pair in 0..pairs {
        let top = &rgba[pair * 2 * width * 4..(pair * 2 + 1) * width * 4];
        let bottom = &rgba[(pair * 2 + 1) * width * 4..(pair * 2 + 2) * width * 4];
        let (y_top, y_bottom) = y[pair * 2 * width..(pair * 2 + 2) * width].split_at_mut(width);
        for x in 0..half {
            let mut sum = [0i32; 3];
            for (row, y_row) in [(top, &mut *y_top), (bottom, &mut *y_bottom)] {
                for dx in 0..2 {
                    let pixel = &row[(x * 2 + dx) * 4..(x * 2 + dx) * 4 + 3];
                    let (r, g, b) = (pixel[0] as i32, pixel[1] as i32, pixel[2] as i32);
                    y_row[x * 2 + dx] = luma(r, g, b);
                    sum[0] += r;
                    sum[1] += g;
                    sum[2] += b;
                }
            }
            let (r, g, b) = ((sum[0] + 2) >> 2, (sum[1] + 2) >> 2, (sum[2] + 2) >> 2);
            let u = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            let v = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
            match &mut chroma {
                Chroma::Planar(u_plane, v_plane) => {
                    u_plane[pair * half + x] = u;
                    v_plane[pair * half + x] = v;
                }
                Chroma::Interleaved(uv) => {
                    uv[pair * width + x * 2] = u;
                    uv[pair * width + x * 2 + 1] = v;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_the_profile_resolution() {
        assert_eq!(target_size(2560, 1440, 1920, 1080), (1920, 1080));
        assert_eq!(target_size(1920, 1080, 1920, 1080), (1920, 1080));
        assert_eq!(target_size(1280, 720, 1920, 1080), (1280, 720));
        assert_eq!(target_size(1001, 601, 0, 0), (1000, 600));
        assert_eq!(target_size(3440, 1440, 1920, 1080), (1920, 802));
    }

    fn solid(width: u32, height: u32, rgb: [u8; 3]) -> Vec<u8> {
        (0..width * height).flat_map(|_| [rgb[0], rgb[1], rgb[2], 255]).collect()
    }

    #[test]
    fn converts_known_colors_in_both_layouts() {
        for layout in [YuvLayout::I420, YuvLayout::Nv12] {
            let mut frame = YuvFrame::new(16, 10, layout);
            let mut converter = Converter::default();
            converter.convert(&solid(16, 10, [255, 255, 255]), 16, 10, &mut frame).unwrap();
            assert!(frame.data[..frame.luma_len()].iter().all(|&y| y == 235));
            assert!(frame.data[frame.luma_len()..].iter().all(|&c| c == 128));
            converter.convert(&solid(16, 10, [255, 0, 0]), 16, 10, &mut frame).unwrap();
            assert_eq!(frame.data[0], 82);
            let chroma = &frame.data[frame.luma_len()..];
            let (u, v) = match layout {
                YuvLayout::I420 => (chroma[0], chroma[chroma.len() / 2]),
                YuvLayout::Nv12 => (chroma[0], chroma[1]),
            };
            assert_eq!((u, v), (90, 240));
        }
    }

    #[test]
    fn scales_down_to_the_frame_size() {
        let mut frame = YuvFrame::new(640, 360, YuvLayout::I420);
        let mut converter = Converter::default();
        converter.convert(&solid(1280, 720, [0, 0, 0]), 1280, 720, &mut frame).unwrap();
        assert!(frame.data[..frame.luma_len()].iter().all(|&y| y == 16));
    }
}
