export const CAPTURE_SOURCE_OPTIONS = [
  { value: 'screen', label: 'Tela' },
  { value: 'camera', label: 'Câmera' },
  { value: 'both', label: 'Tela + câmera' },
] as const;

export type CaptureSource = (typeof CAPTURE_SOURCE_OPTIONS)[number]['value'];
export type CaptureTrackSource = Exclude<CaptureSource, 'both'>;

export const RESOLUTION_OPTIONS = [
  { value: 'original', label: 'Original', width: null, height: null },
  { value: '360p', label: '360p', width: 640, height: 360 },
  { value: '480p', label: '480p', width: 854, height: 480 },
  { value: '720p', label: '720p', width: 1280, height: 720 },
  { value: '1080p', label: '1080p', width: 1920, height: 1080 },
  { value: '2k', label: '2K', width: 2560, height: 1440 },
  { value: '4k', label: '4K', width: 3840, height: 2160 },
  { value: '8k', label: '8K', width: 7680, height: 4320 },
] as const;

export type CaptureResolution = (typeof RESOLUTION_OPTIONS)[number]['value'];

export const FPS_OPTIONS = [15, 24, 30, 60, 120, 144, 160, 200, 240] as const;
export type CaptureFps = (typeof FPS_OPTIONS)[number];

export const BITRATE_OPTIONS = [
  { value: null, label: 'Automático' },
  { value: 2_000_000, label: '2 Mbps' },
  { value: 4_000_000, label: '4 Mbps' },
  { value: 6_000_000, label: '6 Mbps' },
  { value: 8_000_000, label: '8 Mbps' },
  { value: 12_000_000, label: '12 Mbps' },
] as const;

export type CaptureBitrate = (typeof BITRATE_OPTIONS)[number]['value'];
export type CameraFacing = 'user' | 'environment';

export type CaptureSettings = {
  source: CaptureSource;
  resolution: CaptureResolution;
  fps: CaptureFps;
  bitrate: CaptureBitrate;
  screenAudio: boolean;
  microphone: boolean;
  cameraFacing: CameraFacing;
};

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  source: 'screen',
  resolution: '1080p',
  fps: 30,
  bitrate: 6_000_000,
  screenAudio: true,
  microphone: true,
  cameraFacing: 'user',
};

export function getCaptureTracks(source: CaptureSource): CaptureTrackSource[] {
  return source === 'both' ? ['screen', 'camera'] : [source];
}

export function formatCaptureSettings(settings: CaptureSettings): string {
  const source = CAPTURE_SOURCE_OPTIONS.find((option) => option.value === settings.source)?.label.toLowerCase() ?? 'tela';
  const resolution = RESOLUTION_OPTIONS.find((option) => option.value === settings.resolution)?.label ?? '1080p';
  const bitrate = BITRATE_OPTIONS.find((option) => option.value === settings.bitrate)?.label ?? 'Automático';
  const screenAudio = settings.screenAudio ? 'áudio da tela (se disponível)' : 'sem áudio da tela';
  const audio = settings.source === 'camera'
    ? settings.microphone ? 'com microfone' : 'sem microfone'
    : settings.source === 'both'
      ? `${screenAudio} · ${settings.microphone ? 'microfone' : 'sem microfone'}`
      : screenAudio;

  return `${source} · ${resolution} · ${settings.fps} FPS · ${bitrate} · ${audio}`;
}

export function isCaptureSettings(value: unknown): value is CaptureSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Partial<CaptureSettings>;
  return CAPTURE_SOURCE_OPTIONS.some((option) => option.value === settings.source)
    && RESOLUTION_OPTIONS.some((option) => option.value === settings.resolution)
    && FPS_OPTIONS.some((option) => option === settings.fps)
    && BITRATE_OPTIONS.some((option) => option.value === settings.bitrate)
    && typeof settings.screenAudio === 'boolean'
    && typeof settings.microphone === 'boolean'
    && (settings.cameraFacing === 'user' || settings.cameraFacing === 'environment');
}
