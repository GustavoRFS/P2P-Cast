import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform, type Permission } from "react-native";
import {
    P2PCastNative,
    type BroadcastStateEvent,
    type NativeTrack,
} from "../../../modules/p2pcast-native";
import { getCaptureSources, loadCaptureSettings, saveCaptureSettings, type CaptureSettings } from "../../lib/capture";
import { sanitizeChatText } from "../../lib/chat";
import { parseWatchId } from "../../lib/room";
import type { AppError, StreamMode } from "../../lib/types";
import { writeClipboardText } from "../../platform/clipboard";
import type { BroadcastSession, MediaSources, NativeTrackRef } from "./types";
import { useChatCore } from "./useChatCore";

const IDLE: BroadcastStateEvent = {
    mode: "idle",
    error: null,
    shareUrl: null,
    viewerCount: 0,
    audioMuted: false,
    screen: null,
    camera: null,
};

const MODULE_MISSING: AppError = {
    title: "Captura nativa indisponível",
    message: "Este build não inclui o módulo de captura do Android. Use o app gerado pelo build de desenvolvimento.",
};

function toTrackRef(track: NativeTrack): NativeTrackRef | null {
    return track ? { nativeTrackId: track.trackId, hasAudio: track.hasAudio } : null;
}

function errorKey(error: AppError | null): string {
    return error ? `${error.title}\n${error.message}` : "";
}

/** Camera/mic for the chosen sources, plus the notification the foreground service shows. */
async function requestCapturePermissions(settings: CaptureSettings): Promise<AppError | null> {
    const sources = getCaptureSources(settings.source);
    const required: Permission[] = [];
    if (sources.includes("camera")) required.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (settings.microphone || (sources.includes("screen") && settings.audio)) {
        required.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    }
    const optional: Permission[] = Number(Platform.Version) >= 33 ? [PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] : [];
    if (required.length + optional.length === 0) return null;

    const result = await PermissionsAndroid.requestMultiple([...required, ...optional]);
    const denied = required.filter(permission => result[permission] !== PermissionsAndroid.RESULTS.GRANTED);
    if (denied.length === 0) return null;
    return {
        title: "Permissão necessária",
        message: sources.includes("camera")
            ? "Permita o acesso à câmera e ao microfone para iniciar a transmissão."
            : "Permita o acesso ao microfone para transmitir com áudio.",
    };
}

/**
 * Android broadcaster: the Kotlin engine captures (MediaProjection/camera), encodes and talks
 * PeerJS; this hook asks for permissions and consent, and mirrors the engine's state events.
 */
export function useBroadcastSession(setLivePeer?: (peerId: string | null) => void): BroadcastSession {
    const [settings, setSettings] = useState<CaptureSettings>(loadCaptureSettings);
    const [state, setState] = useState<BroadcastStateEvent>(IDLE);
    const [pending, setPending] = useState(false);
    const [localError, setLocalError] = useState<AppError | null>(null);
    const [dismissedError, setDismissedError] = useState("");
    const [copied, setCopied] = useState(false);
    const [canSend, setCanSend] = useState(false);
    const chat = useChatCore();
    const { pushSelf, pushIncoming, reset: resetChat } = chat;
    const seenMessageIds = useRef(new Set<string>());
    const lastShareUrl = useRef<string | null>(null);

    useEffect(() => {
        if (!P2PCastNative) return;
        const stateSubscription = P2PCastNative.addListener("onBroadcastState", event => {
            setState(event);
            if (event.mode !== "idle") setPending(false);
        });
        const chatSubscription = P2PCastNative.addListener("onBroadcastChat", event => {
            setCanSend(event.canSend);
            for (const message of event.messages) {
                if (seenMessageIds.current.has(message.id)) continue;
                seenMessageIds.current.add(message.id);
                if (message.isSelf) pushSelf(message);
                else pushIncoming(message);
            }
        });
        return () => {
            stateSubscription.remove();
            chatSubscription.remove();
        };
    }, [pushIncoming, pushSelf]);

    // Presence and clipboard follow the share link: it exists exactly while the room is open.
    useEffect(() => {
        const shareUrl = state.shareUrl;
        if (shareUrl === lastShareUrl.current) return;
        lastShareUrl.current = shareUrl;
        if (!shareUrl) {
            setLivePeer?.(null);
            setCopied(false);
            seenMessageIds.current.clear();
            resetChat();
            return;
        }
        const queryStart = shareUrl.indexOf("?");
        setLivePeer?.(queryStart >= 0 ? parseWatchId(shareUrl.slice(queryStart)) : null);
        void writeClipboardText(shareUrl).then(() => setCopied(true)).catch(() => undefined);
    }, [resetChat, setLivePeer, state.shareUrl]);

    useEffect(() => {
        saveCaptureSettings(settings);
    }, [settings]);

    const start = useCallback(async (nextSettings?: CaptureSettings) => {
        const effective = nextSettings ?? settings;
        setSettings(effective);
        setLocalError(null);
        setDismissedError("");
        if (!P2PCastNative) {
            setLocalError(MODULE_MISSING);
            return;
        }
        setPending(true);
        try {
            const permissionError = await requestCapturePermissions(effective);
            if (permissionError) throw permissionError;
            if (getCaptureSources(effective.source).includes("screen") && !(await P2PCastNative.requestScreenCapture())) {
                throw { title: "Permissão necessária", message: "Autorize a captura de tela para iniciar a transmissão." } satisfies AppError;
            }
            await P2PCastNative.startBroadcast({ ...effective });
        } catch (error) {
            setPending(false);
            setLocalError(
                typeof error === "object" && error !== null && "title" in error && "message" in error
                    ? error as AppError
                    : {
                        title: "Não foi possível iniciar",
                        message: error instanceof Error ? error.message : "A captura nativa recusou o início da transmissão.",
                    },
            );
        }
    }, [settings]);

    const stop = useCallback(() => {
        setPending(false);
        P2PCastNative?.stopBroadcast();
    }, []);

    const nativeError = state.error && errorKey(state.error) !== dismissedError ? state.error : null;
    const error = localError ?? nativeError;
    const mode: StreamMode = localError
        ? "error"
        : pending && state.mode === "idle" ? "starting" : state.mode;
    const localMedia: MediaSources = { screen: toTrackRef(state.screen), camera: toTrackRef(state.camera) };

    return {
        mode,
        error,
        clearError: () => {
            setLocalError(null);
            setDismissedError(errorKey(state.error));
        },
        settings,
        setSettings,
        shareUrl: state.shareUrl,
        copied,
        viewerCount: state.viewerCount,
        audioMuted: state.audioMuted,
        localMedia,
        chat: {
            messages: chat.messages,
            open: chat.open,
            unread: chat.unread,
            soundEnabled: chat.soundEnabled,
            ready: canSend,
            toggle: chat.toggle,
            toggleSound: chat.toggleSound,
            send: text => {
                const sanitized = sanitizeChatText(text);
                if (sanitized) P2PCastNative?.sendBroadcastChat(sanitized);
            },
        },
        start,
        stop,
        toggleAudio: () => P2PCastNative?.setBroadcastAudioMuted(!state.audioMuted),
        flipCamera: async () => {
            P2PCastNative?.flipCamera();
            setSettings(current => ({ ...current, cameraFacing: current.cameraFacing === "environment" ? "user" : "environment" }));
        },
        copyShareUrl: async () => {
            if (!state.shareUrl) return;
            await writeClipboardText(state.shareUrl);
            setCopied(true);
        },
        desktop: null,
    };
}
