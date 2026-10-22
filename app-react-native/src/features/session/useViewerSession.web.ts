import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCaptureSources, type CaptureTrackSource } from "../../lib/capture";
import {
    buildChatMessage,
    CHAT_CONNECTION_ROLE,
    loadViewerName,
    loadViewerVolume,
    sanitizeChatText,
    saveViewerName,
    saveViewerVolume,
    type ChatMessage,
} from "../../lib/chat";
import { startWatching } from "../../lib/desktop-activity";
import { createPeer, sendPeerLeave } from "../../lib/peer";
import { createNegotiationStream, type NegotiationStream } from "../../lib/receiver";
import { getPeerError } from "../../lib/status";
import type { AppError, StreamMode } from "../../lib/types";
import { createViewerSessionId, loadViewerId } from "../../lib/viewer";
import { EMPTY_MEDIA_SOURCES, type MediaSources, type ViewerSession } from "./types";
import { useChatCore } from "./useChatCore";

/** Viewer session over PeerJS: one call per media source plus the chat data channel. */
export function useViewerSession(broadcastId: string): ViewerSession {
    const [mode, setMode] = useState<StreamMode>("connecting");
    const [error, setError] = useState<AppError | null>(null);
    const [remoteMedia, setRemoteMedia] = useState<MediaSources>(EMPTY_MEDIA_SOURCES);
    const [audioOn, setAudioOn] = useState(false);
    const [volume, setVolumeState] = useState(loadViewerVolume);
    const [chatReady, setChatReady] = useState(false);
    const [viewerName, setViewerName] = useState(loadViewerName);
    const chat = useChatCore();
    const { pushSelf, pushIncoming, reset: resetChat } = chat;
    const peerRef = useRef<Peer | null>(null);
    const mediaCallsRef = useRef<Partial<Record<CaptureTrackSource, MediaConnection>>>({});
    const negotiationsRef = useRef<Partial<Record<CaptureTrackSource, NegotiationStream>>>({});
    const pendingMediaSourcesRef = useRef(new Set<CaptureTrackSource>());
    const receivedMediaSourcesRef = useRef(new Set<CaptureTrackSource>());
    const chatConnRef = useRef<DataConnection | null>(null);
    const viewerNameRef = useRef(viewerName);

    useEffect(() => {
        viewerNameRef.current = viewerName;
    }, [viewerName]);

    useEffect(() => {
        saveViewerVolume(volume);
    }, [volume]);

    const changeViewerName = useCallback((name: string) => {
        setViewerName(name);
        saveViewerName(name);
    }, []);

    const sendChatMessage = useCallback((text: string) => {
        const sanitized = sanitizeChatText(text);
        const conn = chatConnRef.current;
        if (!sanitized || !conn?.open) return;

        const name = viewerNameRef.current.trim();
        conn.send({ text: sanitized, name: name || undefined });
        pushSelf(buildChatMessage({ text: sanitized, authorName: name || "Você", isBroadcaster: false }));
    }, [pushSelf]);

    const cleanup = useCallback(() => {
        const peer = peerRef.current;
        peerRef.current = null;
        Object.values(mediaCallsRef.current).forEach(call => call?.close());
        mediaCallsRef.current = {};
        Object.values(negotiationsRef.current).forEach(negotiation => negotiation?.dispose());
        negotiationsRef.current = {};
        pendingMediaSourcesRef.current.clear();
        receivedMediaSourcesRef.current.clear();
        chatConnRef.current?.close();
        chatConnRef.current = null;
        // Tell the broadcaster right away; otherwise it keeps this session until WebRTC notices.
        if (peer?.open) sendPeerLeave(peer, broadcastId);
        peer?.destroy();
        setRemoteMedia(EMPTY_MEDIA_SOURCES);
        resetChat();
        setChatReady(false);
    }, [broadcastId, resetChat]);

    const connect = useCallback(() => {
        cleanup();
        setMode("connecting");
        setError(null);
        setAudioOn(false);

        try {
            const viewerId = loadViewerId();
            const viewerSessionId = createViewerSessionId();
            const peer = createPeer();
            peerRef.current = peer;

            const fail = (peerError: unknown) => {
                if (peerRef.current !== peer) return;
                cleanup();
                setError(getPeerError(peerError));
                setMode("error");
            };

            peer.on("open", () => {
                if (peerRef.current !== peer) return;

                try {
                    const mediaSources = getCaptureSources("both");
                    pendingMediaSourcesRef.current = new Set(mediaSources);

                    const releaseMediaSource = (source: CaptureTrackSource, sourceError?: unknown) => {
                        if (peerRef.current !== peer) return;

                        pendingMediaSourcesRef.current.delete(source);
                        receivedMediaSourcesRef.current.delete(source);
                        delete mediaCallsRef.current[source];
                        negotiationsRef.current[source]?.dispose();
                        delete negotiationsRef.current[source];
                        setRemoteMedia(current => ({ ...current, [source]: null }));

                        if (pendingMediaSourcesRef.current.size === 0 && receivedMediaSourcesRef.current.size === 0) {
                            fail(sourceError ?? { type: "peer-unavailable" });
                        }
                    };

                    mediaSources.forEach(source => {
                        const negotiation = createNegotiationStream();
                        negotiationsRef.current[source] = negotiation;
                        const call = peer.call(broadcastId, negotiation.stream, {
                            metadata: { role: "viewer", source, viewerId, viewerSessionId },
                        });
                        if (!call) {
                            releaseMediaSource(source, { type: "peer-unavailable" });
                            return;
                        }

                        mediaCallsRef.current[source] = call;
                        call.on("stream", stream => {
                            if (peerRef.current !== peer) return;
                            receivedMediaSourcesRef.current.add(source);
                            setRemoteMedia(current => ({ ...current, [source]: stream }));
                            setMode("watching");
                        });
                        call.on("close", () => releaseMediaSource(source));
                        call.on("error", peerError => releaseMediaSource(source, peerError));
                    });

                    const chatConn = peer.connect(broadcastId, {
                        metadata: { role: CHAT_CONNECTION_ROLE, viewerId, viewerSessionId },
                    });
                    chatConnRef.current = chatConn;
                    chatConn.on("open", () => {
                        if (peerRef.current === peer) setChatReady(true);
                    });
                    chatConn.on("data", data => {
                        if (peerRef.current !== peer) return;
                        if (typeof data !== "object" || data === null) return;

                        const message = data as ChatMessage;
                        if (typeof message.text !== "string" || typeof message.authorName !== "string") return;
                        pushIncoming(message);
                    });
                    const clearChatReady = () => {
                        if (peerRef.current === peer) setChatReady(false);
                    };
                    chatConn.on("close", clearChatReady);
                    chatConn.on("error", clearChatReady);
                } catch (connectionError) {
                    fail(connectionError);
                }
            });

            peer.on("error", peerError => fail(peerError));
            peer.on("disconnected", () => {
                if (peerRef.current === peer) {
                    setError({
                        title: "Sinalização desconectada",
                        message: "A conexão inicial foi perdida. Tente novamente.",
                    });
                }
            });
        } catch (connectionError) {
            cleanup();
            setError(getPeerError(connectionError));
            setMode("error");
        }
    }, [broadcastId, cleanup, pushIncoming]);

    useEffect(() => {
        connect();
        return cleanup;
    }, [connect, cleanup]);

    // The desktop app does not update itself while a live is on screen.
    useEffect(() => startWatching(), []);

    const toggleAudio = useCallback(() => setAudioOn(current => !current), []);

    // Moving the slider also unmutes, like the original player.
    const setVolume = useCallback((nextVolume: number) => {
        setVolumeState(Math.min(1, Math.max(0, nextVolume)));
        setAudioOn(true);
    }, []);

    return {
        mode,
        error,
        remoteMedia,
        audioOn,
        volume,
        chat: {
            messages: chat.messages,
            open: chat.open,
            unread: chat.unread,
            soundEnabled: chat.soundEnabled,
            ready: chatReady,
            toggle: chat.toggle,
            toggleSound: chat.toggleSound,
            send: sendChatMessage,
            name: viewerName,
            setName: changeViewerName,
        },
        toggleAudio,
        setVolume,
        retry: connect,
    };
}
