import { useCallback, useState } from "react";
import { loadCaptureSettings, type CaptureSettings } from "../../lib/capture";
import type { AppError } from "../../lib/types";
import { EMPTY_MEDIA_SOURCES, type BroadcastSession } from "./types";

const NOT_READY: AppError = {
    title: "Transmissão indisponível",
    message: "A captura nativa do Android ainda não está ligada a este build.",
};

// Provisional: replaced by the Android native-module session.
export function useBroadcastSession(_setLivePeer?: (peerId: string | null) => void): BroadcastSession {
    const [settings, setSettings] = useState<CaptureSettings>(loadCaptureSettings);
    const [error, setError] = useState<AppError | null>(null);
    const noop = useCallback(() => undefined, []);

    return {
        mode: error ? "error" : "idle",
        error,
        clearError: () => setError(null),
        settings,
        setSettings,
        shareUrl: null,
        copied: false,
        viewerCount: 0,
        audioMuted: false,
        localMedia: EMPTY_MEDIA_SOURCES,
        chat: {
            messages: [],
            open: false,
            unread: 0,
            soundEnabled: true,
            ready: false,
            toggle: noop,
            toggleSound: noop,
            send: noop,
        },
        start: async () => setError(NOT_READY),
        stop: noop,
        toggleAudio: noop,
        flipCamera: async () => undefined,
        copyShareUrl: async () => undefined,
        desktop: null,
    };
}
