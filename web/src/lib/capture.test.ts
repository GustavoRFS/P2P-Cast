import { describe, expect, it, vi } from "vitest";
import {
    applyVideoBitrate,
    BITRATE_OPTIONS,
    buildCameraMediaOptions,
    buildDisplayMediaOptions,
    buildDisplayMediaVideoConstraints,
    CAPTURE_SOURCE_OPTIONS,
    loadCaptureSettings,
    CURSOR_OPTIONS,
    DEFAULT_CAPTURE_SETTINGS,
    formatCaptureSettings,
    FPS_OPTIONS,
    getCaptureSources,
    RESOLUTION_OPTIONS,
    saveCaptureSettings,
    setCaptureAudioEnabled,
} from "./capture";

function createMemoryStorage(initialValue?: string) {
    let value = initialValue ?? null;

    return {
        getItem: vi.fn(() => value),
        setItem: vi.fn((_key: string, nextValue: string) => {
            value = nextValue;
        }),
    };
}

describe("display capture constraints", () => {
    it("offers screen, camera and combined capture sources", () => {
        expect(CAPTURE_SOURCE_OPTIONS).toEqual([
            { value: "screen", label: "Tela" },
            { value: "camera", label: "Câmera" },
            { value: "both", label: "Tela + câmera" },
        ]);
    });

    it("expands a combined source into screen and camera captures", () => {
        expect(getCaptureSources("screen")).toEqual(["screen"]);
        expect(getCaptureSources("camera")).toEqual(["camera"]);
        expect(getCaptureSources("both")).toEqual(["screen", "camera"]);
    });

    it("offers capture resolutions from 360p through 8K", () => {
        expect(RESOLUTION_OPTIONS.map(({ value, width, height }) => ({ value, width, height }))).toEqual([
            { value: "original", width: undefined, height: undefined },
            { value: "360p", width: 640, height: 360 },
            { value: "480p", width: 854, height: 480 },
            { value: "720p", width: 1280, height: 720 },
            { value: "1080p", width: 1920, height: 1080 },
            { value: "2k", width: 2560, height: 1440 },
            { value: "4k", width: 3840, height: 2160 },
            { value: "8k", width: 7680, height: 4320 },
        ]);
    });

    it("offers high refresh-rate frame options", () => {
        expect(FPS_OPTIONS).toEqual([15, 24, 30, 60, 120, 144, 160, 200, 240]);
    });

    it("limits the selected resolution and frame rate", () => {
        expect(buildDisplayMediaVideoConstraints({
            ...DEFAULT_CAPTURE_SETTINGS,
            resolution: "720p",
            fps: 60,
        })).toEqual({
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 60, max: 60 },
            cursor: "always",
        });
    });

    it("leaves dimensions unconstrained for the original resolution option", () => {
        expect(buildDisplayMediaVideoConstraints({
            ...DEFAULT_CAPTURE_SETTINGS,
            resolution: "original",
            fps: 30,
        })).toEqual({
            frameRate: { ideal: 30, max: 30 },
            cursor: "always",
        });
    });

    it("offers bitrate presets that cover automatic through high-quality sharing", () => {
        expect(BITRATE_OPTIONS.map(option => option.value)).toEqual([
            null,
            2_000_000,
            4_000_000,
            6_000_000,
            8_000_000,
            12_000_000,
        ]);
    });

    it("offers explicit cursor capture choices", () => {
        expect(CURSOR_OPTIONS.map(option => option.value)).toEqual([
            "always",
            "motion",
            "never",
        ]);
    });

    it("summarizes the active video settings", () => {
        expect(formatCaptureSettings(DEFAULT_CAPTURE_SETTINGS)).toBe(
            "tela · 1080p · 30 FPS · 6 Mbps · com áudio",
        );
    });

    it("builds display media options from the selected capture settings", () => {
        expect(buildDisplayMediaOptions({
            ...DEFAULT_CAPTURE_SETTINGS,
            audio: false,
            cursor: "never",
        })).toEqual({
            video: {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 },
                cursor: "never",
            },
            audio: false,
        });
    });

    it("builds camera media options with the same video settings and microphone toggle", () => {
        expect(buildCameraMediaOptions({
            ...DEFAULT_CAPTURE_SETTINGS,
            resolution: "720p",
            fps: 60,
            microphone: false,
        })).toEqual({
            video: {
                width: { ideal: 1280, max: 1280 },
                height: { ideal: 720, max: 720 },
                frameRate: { ideal: 60, max: 60 },
                facingMode: { ideal: "user" },
            },
            audio: false,
        });
    });

    it("defaults the camera to the front-facing lens and can request the rear one", () => {
        expect(buildCameraMediaOptions(DEFAULT_CAPTURE_SETTINGS).video).toMatchObject({
            facingMode: { ideal: "user" },
        });

        expect(buildCameraMediaOptions({
            ...DEFAULT_CAPTURE_SETTINGS,
            cameraFacing: "environment",
        }).video).toMatchObject({
            facingMode: { ideal: "environment" },
        });
    });

    it("enables or mutes every audio track across the active capture streams", () => {
        const screenAudioTrack = { kind: "audio", enabled: true };
        const cameraAudioTrack = { kind: "audio", enabled: true };
        const screenStream = { getAudioTracks: () => [screenAudioTrack] };
        const cameraStream = { getAudioTracks: () => [cameraAudioTrack] };

        setCaptureAudioEnabled([screenStream, cameraStream] as unknown as MediaStream[], false);

        expect(screenAudioTrack.enabled).toBe(false);
        expect(cameraAudioTrack.enabled).toBe(false);

        setCaptureAudioEnabled([screenStream, cameraStream] as unknown as MediaStream[], true);

        expect(screenAudioTrack.enabled).toBe(true);
        expect(cameraAudioTrack.enabled).toBe(true);
    });

    it("applies the selected bitrate only to the video sender", async () => {
        const audioSender = {
            track: { kind: "audio" },
            getParameters: vi.fn(() => ({ encodings: [{}] })),
            setParameters: vi.fn(),
        };
        const videoSender = {
            track: { kind: "video" },
            getParameters: vi.fn(() => ({ encodings: [{ rid: "main" }] })),
            setParameters: vi.fn(),
        };
        const connection = {
            peerConnection: {
                getSenders: () => [audioSender, videoSender],
            },
        } as unknown as Parameters<typeof applyVideoBitrate>[0];

        await applyVideoBitrate(connection, 6_000_000);

        expect(videoSender.setParameters).toHaveBeenCalledWith({
            encodings: [{ rid: "main", maxBitrate: 6_000_000 }],
        });
        expect(audioSender.setParameters).not.toHaveBeenCalled();
    });

    it("removes an existing bitrate limit when automatic mode is selected", async () => {
        const videoSender = {
            track: { kind: "video" },
            getParameters: vi.fn(() => ({ encodings: [{ maxBitrate: 4_000_000 }] })),
            setParameters: vi.fn(),
        };

        await applyVideoBitrate({
            peerConnection: { getSenders: () => [videoSender] },
        } as unknown as Parameters<typeof applyVideoBitrate>[0], null);

        expect(videoSender.setParameters).toHaveBeenCalledWith({ encodings: [{}] });
    });
});

describe("capture settings persistence", () => {
    it("loads the last valid settings from storage", () => {
        const storage = createMemoryStorage(JSON.stringify({
            resolution: "720p",
            fps: 60,
            bitrate: null,
            audio: false,
            cursor: "never",
            source: "camera",
            microphone: true,
        }));

        expect(loadCaptureSettings(storage)).toEqual({
            resolution: "720p",
            fps: 60,
            bitrate: null,
            audio: false,
            cursor: "never",
            source: "camera",
            microphone: true,
            cameraFacing: "user",
        });
    });

    it("falls back to defaults when stored settings are invalid", () => {
        const storage = createMemoryStorage(JSON.stringify({
            resolution: "16k",
            fps: 60,
            bitrate: 6_000_000,
            audio: true,
            cursor: "always",
        }));

        expect(loadCaptureSettings(storage)).toEqual({
            resolution: "1080p",
            fps: 30,
            bitrate: 6_000_000,
            audio: true,
            cursor: "always",
            source: "camera",
            microphone: true,
            cameraFacing: "user",
        });
    });

    it("saves the selected settings as JSON", () => {
        const storage = createMemoryStorage();
        const settings = {
            resolution: "480p" as const,
            fps: 24 as const,
            bitrate: 2_000_000 as const,
            audio: false,
            cursor: "motion" as const,
            source: "both" as const,
            microphone: false,
            cameraFacing: "user" as const,
        };

        saveCaptureSettings(settings, storage);

        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(storage.setItem).toHaveBeenCalledWith(
            "p2pcast.capture-settings",
            JSON.stringify(settings),
        );
    });
});
