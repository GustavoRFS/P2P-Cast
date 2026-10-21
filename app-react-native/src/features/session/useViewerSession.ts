import { useCallback, useEffect, useRef, useState } from "react";
import { P2PCastNative, type NativeTrack, type ViewerStateEvent } from "../../../modules/p2pcast-native";
import {
    loadViewerName,
    loadViewerVolume,
    sanitizeChatText,
    saveViewerName,
    saveViewerVolume,
} from "../../lib/chat";
import type { MediaSources, NativeTrackRef, ViewerSession } from "./types";
import { useChatCore } from "./useChatCore";

function toTrackRef(track: NativeTrack): NativeTrackRef | null {
    return track ? { nativeTrackId: track.trackId, hasAudio: track.hasAudio } : null;
}

const MODULE_MISSING: ViewerStateEvent = {
    mode: "error",
    error: {
        title: "Player nativo indisponível",
        message: "Este build não inclui o módulo de vídeo do Android. Use o app gerado pelo build de desenvolvimento.",
    },
    screen: null,
    camera: null,
};

/** Android viewer: the Kotlin engine connects, decodes and plays; this hook mirrors its state. */
export function useViewerSession(broadcastId: string): ViewerSession {
    const [state, setState] = useState<ViewerStateEvent>(
        P2PCastNative ? { mode: "connecting", error: null, screen: null, camera: null } : MODULE_MISSING,
    );
    const [audioOn, setAudioOn] = useState(false);
    const [volume, setVolumeState] = useState(loadViewerVolume);
    const [viewerName, setViewerName] = useState(loadViewerName);
    const [canSend, setCanSend] = useState(false);
    const chat = useChatCore();
    const { pushSelf, pushIncoming, reset: resetChat } = chat;
    const seenMessageIds = useRef(new Set<string>());
    const viewerNameRef = useRef(viewerName);
    viewerNameRef.current = viewerName;

    useEffect(() => {
        if (!P2PCastNative) return;
        const native = P2PCastNative;
        const stateSubscription = native.addListener("onViewerState", setState);
        const chatSubscription = native.addListener("onViewerChat", event => {
            setCanSend(event.canSend);
            for (const message of event.messages) {
                if (seenMessageIds.current.has(message.id)) continue;
                seenMessageIds.current.add(message.id);
                if (message.isSelf) pushSelf(message);
                else pushIncoming(message);
            }
        });
        native.startViewer(broadcastId);

        return () => {
            stateSubscription.remove();
            chatSubscription.remove();
            native.stopViewer();
            seenMessageIds.current.clear();
            resetChat();
        };
    }, [broadcastId, pushIncoming, pushSelf, resetChat]);

    // Same default as the browser player: muted until the user turns the sound on.
    useEffect(() => {
        P2PCastNative?.setViewerAudio(audioOn, volume);
        saveViewerVolume(volume);
    }, [audioOn, volume, state.screen, state.camera]);

    const setVolume = useCallback((nextVolume: number) => {
        setVolumeState(Math.min(1, Math.max(0, nextVolume)));
        setAudioOn(true);
    }, []);

    const remoteMedia: MediaSources = { screen: toTrackRef(state.screen), camera: toTrackRef(state.camera) };

    return {
        mode: state.mode,
        error: state.error,
        remoteMedia,
        audioOn,
        volume,
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
                if (!sanitized) return;
                const name = viewerNameRef.current.trim();
                P2PCastNative?.sendViewerChat(sanitized, name || null);
            },
            name: viewerName,
            setName: name => {
                setViewerName(name);
                saveViewerName(name);
            },
        },
        toggleAudio: () => setAudioOn(current => !current),
        setVolume,
        retry: () => P2PCastNative?.retryViewer(),
    };
}
