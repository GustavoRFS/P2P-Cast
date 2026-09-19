export const FPS_OPTIONS = [15, 24, 30, 60, 120, 144, 160, 200, 240] as const;

export const BITRATE_OPTIONS = [
    { value: null, label: "Automático" },
    { value: 2_000_000, label: "2 Mbps" },
    { value: 4_000_000, label: "4 Mbps" },
    { value: 6_000_000, label: "6 Mbps" },
    { value: 8_000_000, label: "8 Mbps" },
    { value: 12_000_000, label: "12 Mbps" },
] as const;

export const CURSOR_OPTIONS = [
    { value: "always", label: "Sempre visível" },
    { value: "motion", label: "Ao movimentar" },
    { value: "never", label: "Ocultar" },
] as const;

export type CursorPreference = (typeof CURSOR_OPTIONS)[number]["value"];
type DisplayMediaVideoConstraints = MediaTrackConstraints & { cursor: CursorPreference };

export const RESOLUTION_OPTIONS = [
    { value: "original", label: "Original", width: undefined, height: undefined },
    { value: "360p", label: "360p", width: 640, height: 360 },
    { value: "480p", label: "480p", width: 854, height: 480 },
    { value: "720p", label: "720p", width: 1280, height: 720 },
    { value: "1080p", label: "1080p", width: 1920, height: 1080 },
    { value: "2k", label: "2K", width: 2560, height: 1440 },
    { value: "4k", label: "4K", width: 3840, height: 2160 },
    { value: "8k", label: "8K", width: 7680, height: 4320 },
] as const;

export type CaptureSettings = {
    resolution: (typeof RESOLUTION_OPTIONS)[number]["value"];
    fps: (typeof FPS_OPTIONS)[number];
    bitrate: (typeof BITRATE_OPTIONS)[number]["value"];
    audio: boolean;
    cursor: CursorPreference;
};

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
    resolution: "1080p",
    fps: 30,
    bitrate: 6_000_000,
    audio: true,
    cursor: "always",
};

export const CAPTURE_SETTINGS_STORAGE_KEY = "p2pcast.capture-settings";

type CaptureSettingsStorage = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): CaptureSettingsStorage | null {
    if (typeof window === "undefined") return null;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function isCaptureSettings(value: unknown): value is CaptureSettings {
    if (typeof value !== "object" || value === null) return false;

    const settings = value as Partial<CaptureSettings>;
    return RESOLUTION_OPTIONS.some(option => option.value === settings.resolution)
        && FPS_OPTIONS.some(fps => fps === settings.fps)
        && BITRATE_OPTIONS.some(option => option.value === settings.bitrate)
        && typeof settings.audio === "boolean"
        && CURSOR_OPTIONS.some(option => option.value === settings.cursor);
}

export function loadCaptureSettings(storage = getBrowserStorage()): CaptureSettings {
    if (!storage) return { ...DEFAULT_CAPTURE_SETTINGS };

    try {
        const storedSettings = storage.getItem(CAPTURE_SETTINGS_STORAGE_KEY);
        if (!storedSettings) return { ...DEFAULT_CAPTURE_SETTINGS };

        const parsedSettings: unknown = JSON.parse(storedSettings);
        if (!isCaptureSettings(parsedSettings)) return { ...DEFAULT_CAPTURE_SETTINGS };

        return {
            resolution: parsedSettings.resolution,
            fps: parsedSettings.fps,
            bitrate: parsedSettings.bitrate,
            audio: parsedSettings.audio,
            cursor: parsedSettings.cursor,
        };
    } catch {
        return { ...DEFAULT_CAPTURE_SETTINGS };
    }
}

export function saveCaptureSettings(settings: CaptureSettings, storage = getBrowserStorage()): void {
    if (!storage) return;

    try {
        storage.setItem(CAPTURE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Storage can be unavailable in private browsing or restrictive contexts.
    }
}

export function formatCaptureSettings(settings: CaptureSettings): string {
    const bitrate = BITRATE_OPTIONS.find(option => option.value === settings.bitrate)?.label ?? "Automático";
    return `${settings.resolution === "original" ? "Original" : settings.resolution} · ${settings.fps} FPS · ${bitrate} · ${settings.audio ? "com áudio" : "sem áudio"}`;
}

export function buildDisplayMediaVideoConstraints(settings: CaptureSettings): DisplayMediaVideoConstraints {
    const resolution = RESOLUTION_OPTIONS.find(option => option.value === settings.resolution);

    return {
        ...(resolution?.width && resolution.height
            ? {
                width: { ideal: resolution.width, max: resolution.width },
                height: { ideal: resolution.height, max: resolution.height },
            }
            : {}),
        frameRate: { ideal: settings.fps, max: settings.fps },
        cursor: settings.cursor,
    };
}

export function buildDisplayMediaOptions(settings: CaptureSettings): DisplayMediaStreamOptions {
    return {
        video: buildDisplayMediaVideoConstraints(settings),
        audio: settings.audio,
    };
}

export async function applyVideoBitrate(
    connection: { peerConnection: Pick<RTCPeerConnection, "getSenders"> },
    bitrate: CaptureSettings["bitrate"],
): Promise<void> {
    const videoSender = connection.peerConnection.getSenders().find(sender => sender.track?.kind === "video");
    if (!videoSender) return;

    const parameters = videoSender.getParameters();
    const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings = encodings.map(encoding => {
        const nextEncoding = { ...encoding };
        if (bitrate === null) {
            delete nextEncoding.maxBitrate;
        } else {
            nextEncoding.maxBitrate = bitrate;
        }
        return nextEncoding;
    });

    await videoSender.setParameters(parameters);
}
