import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    applyVideoBitrate,
    buildCameraMediaOptions,
    buildCameraVideoConstraints,
    buildDisplayMediaOptions,
    getCaptureSources,
    loadCaptureSettings,
    saveCaptureSettings,
    setCaptureAudioEnabled,
    RESOLUTION_OPTIONS,
    type CaptureSettings,
    type CaptureTrackSource,
} from "../../lib/capture";
import { recordCaptureFailure } from "../../lib/capture-failure-log";
import {
    buildChatMessage,
    CHAT_CONNECTION_ROLE,
    resolveAuthorName,
    sanitizeChatText,
} from "../../lib/chat";
import {
    captureDesktopWindow,
    getDesktopConfig,
    isDesktopApp,
    listDesktopCaptureTargets,
    nativeBroadcastEnabled,
    refreshDesktopCapture,
    releaseDesktopCapture,
    resolveDesktopCaptureTarget,
    type DesktopConfig,
} from "../../lib/desktop";
import { createPeer, sendPeerLeave } from "../../lib/peer";
import { buildWatchUrl, loadBroadcastId, saveBroadcastId } from "../../lib/room";
import { loadShortcutProfiles, SYSTEM_AUDIO_SOURCE, type ShortcutProfile } from "../../lib/shortcut-profiles";
import { getMediaError, getPeerError } from "../../lib/status";
import type { AppError, StreamMode } from "../../lib/types";
import { writeClipboardText } from "../../platform/clipboard";
import type { BroadcastSession, NativeSenderInfo } from "./types";
import { useChatCore } from "./useChatCore";

const MAX_MEDIA_CONNECTIONS_PER_SESSION = 2;

const SIGNALING_LOST: AppError = {
    title: "Sinalização desconectada",
    message: "Quem já está assistindo continua; novos espectadores entram assim que a conexão voltar.",
};

type CaptureStreams = Record<CaptureTrackSource, MediaStream | null>;

const EMPTY_STREAMS: CaptureStreams = { screen: null, camera: null };

function getMediaConnectionIdentity(peerId: string, metadata: unknown): string {
    if (typeof metadata === "object" && metadata !== null && "viewerId" in metadata) {
        const viewerId = (metadata as { viewerId?: unknown }).viewerId;
        if (typeof viewerId === "string" && viewerId.trim() && viewerId.length <= 128) {
            return `viewer:${viewerId.trim()}`;
        }
    }

    return `peer:${peerId}`;
}

function getMediaConnectionSessionId(peerId: string, metadata: unknown): string {
    if (typeof metadata === "object" && metadata !== null && "viewerSessionId" in metadata) {
        const sessionId = (metadata as { viewerSessionId?: unknown }).viewerSessionId;
        if (typeof sessionId === "string" && sessionId.trim() && sessionId.length <= 128) {
            return `session:${sessionId.trim()}`;
        }
    }

    return `peer:${peerId}`;
}

function stopCaptureStreams(streams: CaptureStreams) {
    Object.values(streams).forEach(stream => {
        releaseDesktopCapture(stream);
        stream?.getTracks().forEach(track => track.stop());
    });
}

/**
 * Broadcaster session for the browser and the Tauri shell, over PeerJS. Inside Tauri the screen
 * comes from the native capture helpers and starts only from a shortcut profile.
 */
export function useBroadcastSession(setLivePeer?: (peerId: string | null) => void): BroadcastSession {
    const desktopMode = isDesktopApp();
    const [mode, setMode] = useState<StreamMode>("idle");
    const [error, setError] = useState<AppError | null>(null);
    const [localStreams, setLocalStreams] = useState<CaptureStreams>(EMPTY_STREAMS);
    const [settings, setSettings] = useState<CaptureSettings>(loadCaptureSettings);
    const [desktopConfig, setDesktopConfig] = useState<DesktopConfig | null>(null);
    const [captureTargets, setCaptureTargets] = useState<DesktopCaptureTarget[]>([]);
    const [shortcutProfiles, setShortcutProfiles] = useState<ShortcutProfile[]>(loadShortcutProfiles);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [viewerCount, setViewerCount] = useState(0);
    const [copied, setCopied] = useState(false);
    const [audioMuted, setAudioMuted] = useState(false);
    const [nativeSender, setNativeSender] = useState<NativeSenderInfo | null>(null);
    // The desktop app sends this live itself: no PeerJS peer or local streams on this page.
    const nativeRef = useRef(false);
    // Bumped by stop(), so a native start that resolves after the live was ended is undone.
    const stopCountRef = useRef(0);
    const chat = useChatCore();
    const { pushSelf, pushIncoming, reset: resetChat } = chat;
    const localStreamsRef = useRef<CaptureStreams>(EMPTY_STREAMS);
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const peerRef = useRef<Peer | null>(null);
    const callsRef = useRef<MediaConnection[]>([]);
    const chatConnectionsRef = useRef<DataConnection[]>([]);
    const chatViewerIndexRef = useRef(0);

    const refreshTargets = useCallback(async () => {
        if (!desktopMode) return;
        try {
            setCaptureTargets(await listDesktopCaptureTargets());
        } catch {
            setCaptureTargets([]);
            setError({ title: "Não foi possível listar os programas", message: "Confira as permissões de captura de tela do sistema e atualize a lista." });
        }
    }, [desktopMode]);

    useEffect(() => {
        if (!desktopMode) return;
        let active = true;
        void getDesktopConfig().then(config => {
            if (!active || !config) return;
            setDesktopConfig(config);
            if (!config.isolatedAudioAvailable) {
                setSettings(current => current.audio ? { ...current, audio: false } : current);
            }
        }).catch(() => {
            if (active) setError({ title: "Configuração desktop indisponível", message: "A captura de janela ainda funciona, mas não foi possível ler as opções de áudio isolado." });
        });
        return () => { active = false; };
    }, [desktopMode]);

    useEffect(() => {
        void refreshTargets();
    }, [refreshTargets]);

    const sendChatMessage = useCallback((text: string) => {
        const sanitized = sanitizeChatText(text);
        if (!sanitized) return;

        const message = buildChatMessage({ text: sanitized, authorName: "Transmissor", isBroadcaster: true });
        pushSelf(message);
        if (nativeRef.current) {
            void window.p2pcastDesktop?.sendNativeChat?.(message).catch(() => undefined);
            return;
        }
        chatConnectionsRef.current.forEach(conn => {
            if (conn.open) conn.send(message);
        });
    }, [pushSelf]);

    const updateViewerCount = useCallback(() => {
        setViewerCount(new Set(callsRef.current.map(call => call.peer)).size);
    }, []);

    const stop = useCallback(() => {
        setLivePeer?.(null);
        stopCountRef.current += 1;
        if (nativeRef.current) {
            nativeRef.current = false;
            void window.p2pcastDesktop?.stopNativeBroadcast?.().catch(() => undefined);
        }
        setNativeSender(null);
        const peer = peerRef.current;
        peerRef.current = null;

        callsRef.current.forEach(call => call.close());
        callsRef.current = [];
        chatConnectionsRef.current.forEach(conn => conn.close());
        chatConnectionsRef.current = [];
        chatViewerIndexRef.current = 0;
        stopCaptureStreams(localStreamsRef.current);
        localStreamsRef.current = EMPTY_STREAMS;

        peer?.destroy();
        setLocalStreams(EMPTY_STREAMS);
        setShareUrl(null);
        setViewerCount(0);
        setCopied(false);
        setAudioMuted(false);
        resetChat();
        setMode("idle");
    }, [resetChat, setLivePeer]);

    const startBroadcast = useCallback(async (
        nextSettings: CaptureSettings,
        sourceId?: string,
        profile?: ShortcutProfile,
        audioSourceId?: string,
    ) => {
        setMode("starting");
        setError(null);
        setCopied(false);
        setSettings(nextSettings);
        setAudioMuted(false);

        const nextStreams: CaptureStreams = { ...EMPTY_STREAMS };
        try {
            const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
            if (!window.isSecureContext && !isLocalhost) {
                throw new TypeError("Media capture requires a secure context");
            }

            const sources = getCaptureSources(nextSettings.source);
            if (sources.includes("screen") && !navigator.mediaDevices?.getDisplayMedia) {
                throw new TypeError("Screen capture is not supported");
            }
            if (sources.includes("camera") && !navigator.mediaDevices?.getUserMedia) {
                throw new TypeError("Camera capture is not supported");
            }

            if (sources.includes("screen") && desktopMode && profile?.captureMethod === "direct" && sourceId
                && desktopConfig?.nativeBroadcastAvailable && window.p2pcastDesktop?.startNativeBroadcast
                && nativeBroadcastEnabled()) {
                // The app captures, encodes once (on the GPU when it can) and serves every viewer.
                try {
                    const stopCount = stopCountRef.current;
                    const resolution = RESOLUTION_OPTIONS.find(option => option.value === nextSettings.resolution);
                    const { peerId } = await window.p2pcastDesktop.startNativeBroadcast({
                        peerId: loadBroadcastId(),
                        videoSourceId: sourceId,
                        audioSourceId: nextSettings.audio ? audioSourceId ?? null : null,
                        fps: nextSettings.fps,
                        cursor: nextSettings.cursor,
                        maxWidth: resolution?.width ?? 0,
                        maxHeight: resolution?.height ?? 0,
                        bitrate: nextSettings.bitrate,
                    });
                    if (stopCountRef.current !== stopCount) {
                        void window.p2pcastDesktop.stopNativeBroadcast?.().catch(() => undefined);
                        return;
                    }
                    nativeRef.current = true;
                    saveBroadcastId(peerId);
                    const watchUrl = buildWatchUrl(desktopConfig.webUrl ?? window.location.origin, "/", peerId);
                    setShareUrl(watchUrl);
                    void writeClipboardText(watchUrl).then(() => setCopied(true)).catch(() => undefined);
                    setNativeSender({ encoder: null });
                    setViewerCount(0);
                    setLivePeer?.(peerId);
                    setMode("broadcasting");
                    return;
                } catch (nativeError) {
                    // Fall back to the webview pipeline below, which still works everywhere.
                    recordCaptureFailure("nativeBroadcast", nativeError);
                    console.warn("Native sender unavailable, using the webview pipeline:", nativeError);
                }
            }

            if (sources.includes("screen")) {
                if (desktopMode) {
                    if (!profile) throw new Error("No desktop, a transmissão de tela começa pelo atalho configurado.");
                    if (!sourceId) throw new TypeError("Selecione uma janela ou aplicativo para transmitir.");
                    if (!desktopConfig) throw new Error("A configuração desktop ainda não está disponível.");
                    nextStreams.screen = await captureDesktopWindow(sourceId, nextSettings, desktopConfig, {
                        captureMethod: profile.captureMethod,
                        targetKind: profile.videoTarget.kind,
                        audioSourceId,
                    });
                } else {
                    nextStreams.screen = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions(nextSettings));
                }
            }
            if (sources.includes("camera")) {
                nextStreams.camera = await navigator.mediaDevices.getUserMedia(buildCameraMediaOptions(nextSettings));
            }

            localStreamsRef.current = nextStreams;
            setLocalStreams(nextStreams);
            setCaptureAudioEnabled(Object.values(nextStreams), true);

            const peer = createPeer(loadBroadcastId() ?? undefined);
            peerRef.current = peer;

            Object.values(nextStreams).forEach(stream => {
                stream?.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
            });

            peer.on("open", id => {
                saveBroadcastId(id);
                // Viewers always land on the root page, which forwards ?watch= to the viewer route.
                const shareOrigin = desktopMode ? desktopConfig?.webUrl ?? window.location.origin : window.location.origin;
                const watchUrl = buildWatchUrl(shareOrigin, "/", id);
                setShareUrl(watchUrl);
                void writeClipboardText(watchUrl).then(() => setCopied(true)).catch(() => undefined);
                setLivePeer?.(id);
                setMode("broadcasting");
            });

            peer.on("call", call => {
                const requestedSource: CaptureTrackSource = call.metadata?.source === "camera" ? "camera" : "screen";
                const stream = localStreamsRef.current[requestedSource];
                if (!stream) {
                    call.close();
                    return;
                }

                const viewerIdentity = getMediaConnectionIdentity(call.peer, call.metadata);
                const viewerSessionId = getMediaConnectionSessionId(call.peer, call.metadata);
                const activeCallsForViewer = callsRef.current.filter(activeCall =>
                    getMediaConnectionIdentity(activeCall.peer, activeCall.metadata) === viewerIdentity,
                );
                // A viewer's newest session wins. One that left (or reloaded) and comes back must not be
                // locked out by its old calls: PeerJS can take a long time, or never, to report them
                // closed. Two tabs on one device end up with the newest one.
                const staleCalls = activeCallsForViewer.filter(activeCall =>
                    getMediaConnectionSessionId(activeCall.peer, activeCall.metadata) !== viewerSessionId,
                );
                if (staleCalls.length) {
                    const stalePeers = new Set(staleCalls.map(staleCall => staleCall.peer));
                    callsRef.current = callsRef.current.filter(activeCall => !staleCalls.includes(activeCall));
                    staleCalls.forEach(staleCall => staleCall.close());
                    chatConnectionsRef.current
                        .filter(conn => stalePeers.has(conn.peer))
                        .forEach(conn => conn.close());
                    updateViewerCount();
                }
                if (activeCallsForViewer.length - staleCalls.length >= MAX_MEDIA_CONNECTIONS_PER_SESSION) {
                    call.close();
                    sendPeerLeave(peer, call.peer);
                    return;
                }

                callsRef.current.push(call);
                updateViewerCount();

                const removeCall = () => {
                    callsRef.current = callsRef.current.filter(activeCall => activeCall !== call);
                    updateViewerCount();
                };
                call.on("close", removeCall);
                call.on("error", removeCall);

                call.answer(stream);
                void applyVideoBitrate(call, nextSettings.bitrate).catch(() => undefined);
                // The desktop capture only sends frames when the window changes; without this a
                // viewer that joins during a still picture sees nothing until something moves.
                const connection = call.peerConnection;
                const refreshWhenConnected = () => {
                    if (connection.connectionState !== "connected") return;
                    connection.removeEventListener("connectionstatechange", refreshWhenConnected);
                    refreshDesktopCapture(stream);
                };
                connection?.addEventListener("connectionstatechange", refreshWhenConnected);
            });

            peer.on("connection", conn => {
                if (conn.metadata?.role !== CHAT_CONNECTION_ROLE) return;

                chatViewerIndexRef.current += 1;
                const viewerIndex = chatViewerIndexRef.current;
                chatConnectionsRef.current.push(conn);

                conn.on("data", data => {
                    if (typeof data !== "object" || data === null) return;
                    const draft = data as { text?: unknown; name?: unknown };
                    if (typeof draft.text !== "string") return;

                    const text = sanitizeChatText(draft.text);
                    if (!text) return;

                    const authorName = resolveAuthorName(
                        typeof draft.name === "string" ? draft.name : undefined,
                        viewerIndex,
                    );
                    const message = buildChatMessage({ text, authorName, isBroadcaster: false });
                    pushIncoming(message);

                    chatConnectionsRef.current.forEach(activeConn => {
                        if (activeConn !== conn && activeConn.open) activeConn.send(message);
                    });
                });

                const removeConnection = () => {
                    chatConnectionsRef.current = chatConnectionsRef.current.filter(activeConn => activeConn !== conn);
                };
                conn.on("close", removeConnection);
                conn.on("error", removeConnection);
            });

            peer.on("error", peerError => {
                if (peerRef.current !== peer) return;
                stop();
                setError(getPeerError(peerError));
                setMode("error");
            });

            peer.on("disconnected", () => {
                if (peerRef.current === peer) {
                    setError({
                        title: "Sinalização desconectada",
                        message: "A transmissão atual pode continuar, mas novos espectadores talvez não consigam entrar.",
                    });
                }
            });
        } catch (captureError) {
            if (localStreamsRef.current !== nextStreams) stopCaptureStreams(nextStreams);
            stop();
            recordCaptureFailure("startBroadcast", captureError);
            setError(getMediaError(captureError, nextSettings.source));
            setMode("error");
        }
    }, [desktopConfig, desktopMode, pushIncoming, setLivePeer, stop, updateViewerCount]);

    // Global shortcuts: each profile starts its own capture, with its own settings.
    useEffect(() => {
        if (!desktopMode || !window.p2pcastDesktop?.registerShortcutProfiles) return;
        let active = true;
        const registration = shortcutProfiles.map(({ id, shortcut }) => ({ id, shortcut }));
        void window.p2pcastDesktop.registerShortcutProfiles(registration).then(results => {
            if (!active) return;
            const failed = results.filter(result => !result.ok);
            if (failed.length) {
                setError({
                    title: "Alguns atalhos não foram registrados",
                    message: `${failed.length} atalho(s) estão duplicados ou indisponíveis no Windows. Edite o perfil e escolha outra combinação.`,
                });
            }
        }).catch(() => {
            if (active && shortcutProfiles.length) setError({ title: "Não foi possível registrar os atalhos", message: "Reabra as configurações dos atalhos e tente novamente." });
        });
        const removeListener = window.p2pcastDesktop.onShortcutProfile?.(profileId => {
            const profile = shortcutProfiles.find(item => item.id === profileId);
            if (!profile) return;
            if (modeRef.current !== "idle" && modeRef.current !== "error") {
                setError({ title: "Já existe uma transmissão ativa", message: "Encerre a transmissão atual antes de iniciar outro perfil." });
                return;
            }
            void (async () => {
                const video = await resolveDesktopCaptureTarget(profile.videoTarget.selector);
                // Monitor profiles take the system audio; window profiles need that window running.
                const systemAudio = profile.audioSourceSelector === SYSTEM_AUDIO_SOURCE;
                const audio = systemAudio ? null : await resolveDesktopCaptureTarget(profile.audioSourceSelector);
                if (!video || (!systemAudio && (!audio || audio.kind !== "window"))) {
                    setError({ title: "Programa indisponível", message: "Abra novamente o programa de vídeo e áudio selecionado e atualize os alvos." });
                    return;
                }
                await startBroadcast(profile.settings, video.id, profile, systemAudio ? SYSTEM_AUDIO_SOURCE : audio!.id);
            })().catch(captureError => {
                recordCaptureFailure("shortcutProfile", captureError);
                setError(getMediaError(captureError, "screen"));
                setMode("error");
            });
        });
        return () => {
            active = false;
            removeListener?.();
            void window.p2pcastDesktop?.registerShortcutProfiles?.([]);
        };
    }, [desktopMode, shortcutProfiles, startBroadcast]);

    // The native capture helpers report failures as window events; never fall back silently.
    useEffect(() => {
        const onAudioError = (event: Event) => {
            const message = event instanceof CustomEvent && typeof event.detail === "string"
                ? event.detail
                : "A captura do áudio deste aplicativo foi interrompida.";
            stop();
            setError({
                title: "Áudio isolado interrompido",
                message: `${message} A transmissão foi encerrada para evitar trocar para o áudio global do sistema.`,
            });
            setMode("error");
        };
        const onVideoError = (event: Event) => {
            const message = event instanceof CustomEvent && typeof event.detail === "string"
                ? event.detail
                : "A captura direta de vídeo foi interrompida.";
            stop();
            setError({ title: "Captura de vídeo interrompida", message: `${message} A transmissão foi encerrada.` });
            setMode("error");
        };
        window.addEventListener("p2pcast:application-audio-error", onAudioError);
        window.addEventListener("p2pcast:direct-video-error", onVideoError);
        return () => {
            window.removeEventListener("p2pcast:application-audio-error", onAudioError);
            window.removeEventListener("p2pcast:direct-video-error", onVideoError);
        };
    }, [stop]);

    // What the app's native sender reports about the live it is sending.
    useEffect(() => {
        if (!desktopMode || !window.p2pcastDesktop?.onNativeBroadcastEvent) return;
        return window.p2pcastDesktop.onNativeBroadcastEvent(event => {
            if (!nativeRef.current) return;
            switch (event.type) {
                case "viewers":
                    setViewerCount(event.count);
                    break;
                case "chat":
                    pushIncoming(event.message);
                    break;
                case "encoder": {
                    const { name, hardware, width, height, fps, bitrate } = event;
                    setNativeSender({ encoder: { name, hardware, width, height, fps, bitrate } });
                    break;
                }
                case "signalingLost":
                    setError(SIGNALING_LOST);
                    break;
                case "signalingRestored":
                    setError(current => (current === SIGNALING_LOST ? null : current));
                    break;
                case "fatal":
                    stop();
                    setError({ title: "A transmissão parou", message: event.message });
                    setMode("error");
                    break;
            }
        });
    }, [desktopMode, pushIncoming, stop]);

    useEffect(() => {
        saveCaptureSettings(settings);
    }, [settings]);

    useEffect(() => stop, [stop]);

    const toggleAudio = useCallback(() => {
        const nextMuted = !audioMuted;
        if (nativeRef.current) void window.p2pcastDesktop?.setNativeAudioMuted?.(nextMuted).catch(() => undefined);
        setCaptureAudioEnabled(Object.values(localStreamsRef.current), !nextMuted);
        setAudioMuted(nextMuted);
    }, [audioMuted]);

    const flipCamera = useCallback(async () => {
        const cameraStream = localStreamsRef.current.camera;
        if (!cameraStream) return;

        const nextFacing: CaptureSettings["cameraFacing"] = settings.cameraFacing === "environment" ? "user" : "environment";

        try {
            const replacementStream = await navigator.mediaDevices.getUserMedia({
                video: buildCameraVideoConstraints({ ...settings, cameraFacing: nextFacing }),
                audio: false,
            });
            const newVideoTrack = replacementStream.getVideoTracks()[0];
            if (!newVideoTrack) return;

            newVideoTrack.addEventListener("ended", stop, { once: true });

            callsRef.current
                .filter(call => call.metadata?.source === "camera")
                .forEach(call => {
                    const sender = call.peerConnection.getSenders().find(activeSender => activeSender.track?.kind === "video");
                    void sender?.replaceTrack(newVideoTrack);
                });

            const oldVideoTrack = cameraStream.getVideoTracks()[0];
            cameraStream.addTrack(newVideoTrack);
            if (oldVideoTrack) {
                cameraStream.removeTrack(oldVideoTrack);
                oldVideoTrack.stop();
            }

            setSettings(current => ({ ...current, cameraFacing: nextFacing }));
        } catch (flipError) {
            setError(getMediaError(flipError, "camera"));
        }
    }, [settings, stop]);

    const copyShareUrl = useCallback(async () => {
        if (!shareUrl) return;

        try {
            await writeClipboardText(shareUrl);
            setCopied(true);
        } catch {
            setError({
                title: "Não foi possível copiar",
                message: "Selecione e copie o link manualmente.",
            });
        }
    }, [shareUrl]);

    const start = useCallback((nextSettings?: CaptureSettings) => startBroadcast(nextSettings ?? settings), [settings, startBroadcast]);
    const clearError = useCallback(() => setError(null), []);

    return {
        mode,
        error,
        clearError,
        settings,
        setSettings,
        shareUrl,
        copied,
        viewerCount,
        audioMuted,
        localMedia: localStreams,
        chat: {
            messages: chat.messages,
            open: chat.open,
            unread: chat.unread,
            soundEnabled: chat.soundEnabled,
            ready: true,
            toggle: chat.toggle,
            toggleSound: chat.toggleSound,
            send: sendChatMessage,
        },
        start,
        stop,
        toggleAudio,
        flipCamera,
        copyShareUrl,
        desktop: desktopMode
            ? {
                config: desktopConfig,
                captureTargets,
                refreshTargets: () => void refreshTargets(),
                shortcutProfiles,
                setShortcutProfiles,
            }
            : null,
        nativeSender,
    };
}
