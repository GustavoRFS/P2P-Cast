import { useCallback } from "react";
import { EMPTY_MEDIA_SOURCES, type ViewerSession } from "./types";

// Provisional: replaced by the Android native-module session.
export function useViewerSession(_broadcastId: string): ViewerSession {
    const noop = useCallback(() => undefined, []);

    return {
        mode: "error",
        error: {
            title: "Visualização indisponível",
            message: "O player nativo do Android ainda não está ligado a este build.",
        },
        remoteMedia: EMPTY_MEDIA_SOURCES,
        audioOn: false,
        volume: 1,
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
        toggleAudio: noop,
        setVolume: noop,
        retry: noop,
    };
}
