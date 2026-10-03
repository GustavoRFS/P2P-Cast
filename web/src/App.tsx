import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { DataConnection, MediaConnection, Peer } from "peerjs";
import {
    applyVideoBitrate,
    BITRATE_OPTIONS,
    buildCameraMediaOptions,
    buildCameraVideoConstraints,
    buildDisplayMediaOptions,
    CURSOR_OPTIONS,
    FPS_OPTIONS,
    formatCaptureSettings,
    getAvailableCaptureSourceOptions,
    getCaptureSources,
    loadCaptureSettings,
    RESOLUTION_OPTIONS,
    saveCaptureSettings,
    setCaptureAudioEnabled,
    type CaptureSettings,
    type CaptureTrackSource,
} from "./lib/capture";
import {
    buildChatMessage,
    CHAT_CONNECTION_ROLE,
    CHAT_MAX_MESSAGE_LENGTH,
    formatMessageTime,
    loadChatSoundEnabled,
    loadViewerName,
    loadViewerVolume,
    resolveAuthorName,
    saveChatSoundEnabled,
    sanitizeChatText,
    saveViewerName,
    saveViewerVolume,
    shouldPlayChatNotification,
    type ChatMessage,
} from "./lib/chat";
import { createChatNotificationPlayer, type ChatNotificationPlayer } from "./lib/chat-sound";
import { createPeer, sendPeerLeave } from "./lib/peer";
import { createNegotiationStream, type NegotiationStream } from "./lib/receiver";
import { buildWatchUrl, loadBroadcastId, parseWatchId, saveBroadcastId } from "./lib/room";
import { createViewerSessionId, loadViewerId } from "./lib/viewer";
import { getMediaError, getPeerError } from "./lib/status";
import type { AppError, StreamMode } from "./types";

const MAX_MEDIA_CONNECTIONS_PER_SESSION = 2;

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

const MODE_LABELS: Record<StreamMode, string> = {
    idle: "Pronto para começar",
    starting: "Preparando transmissão",
    broadcasting: "Transmissão ativa",
    connecting: "Conectando à transmissão",
    watching: "Assistindo ao vivo",
    error: "A conexão precisa de atenção",
};

const genericError: AppError = {
    title: "Não foi possível conectar",
    message: "Confira o link e tente novamente.",
};

function stopTracks(stream: MediaStream | null) {
    stream?.getTracks().forEach(track => track.stop());
}

type CaptureStreams = Record<CaptureTrackSource, MediaStream | null>;
type RemoteStreams = CaptureStreams;

const EMPTY_CAPTURE_STREAMS: CaptureStreams = {
    screen: null,
    camera: null,
};

function stopCaptureStreams(streams: CaptureStreams) {
    Object.values(streams).forEach(stopTracks);
}

function getStreamForSource(streams: CaptureStreams, source: CaptureTrackSource) {
    return streams[source];
}

function goHome() {
    window.location.href = window.location.pathname;
}

function AppHeader({ eyebrow = "P2P CAST", onHome }: { eyebrow?: string; onHome?: () => void }) {
    return (
        <header className="app-header">
            <button className="brand-button" onClick={onHome ?? goHome} aria-label="Voltar para o início">
                <span className="brand-mark" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </span>
                <span className="brand-name">p2p<span>cast</span></span>
            </button>
            <div className="header-meta">
                <span className="eyebrow">{eyebrow}</span>
                <span className="header-dot" aria-hidden="true" />
                <span className="header-note">sem servidor de vídeo</span>
            </div>
        </header>
    );
}

function StatusPill({ mode }: { mode: StreamMode }) {
    const isLive = mode === "broadcasting" || mode === "watching";

    return (
        <span className={isLive ? "status-pill is-live" : "status-pill"}>
            <span className="status-dot" aria-hidden="true" />
            {MODE_LABELS[mode]}
        </span>
    );
}

function ErrorCard({
    error,
    onRetry,
    onHome,
}: {
    error: AppError;
    onRetry?: () => void;
    onHome: () => void;
}) {
    return (
        <div className="error-card" role="alert">
            <div className="error-icon" aria-hidden="true">!</div>
            <div>
                <strong>{error.title}</strong>
                <p>{error.message}</p>
                {error.details && <small>{error.details}</small>}
            </div>
            <div className="error-actions">
                {onRetry && (
                    <button className="button button-secondary button-small" onClick={onRetry}>
                        Tentar novamente
                    </button>
                )}
                <button className="text-button" onClick={onHome}>
                    Voltar ao início
                </button>
            </div>
        </div>
    );
}

function HomeView({
    settings,
    onSettingsChange,
    onStart,
}: {
    settings: CaptureSettings;
    onSettingsChange: Dispatch<SetStateAction<CaptureSettings>>;
    onStart: (settings: CaptureSettings) => void;
}) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsSummary = formatCaptureSettings(settings);

    useEffect(() => {
        if (!settingsOpen) return;

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSettingsOpen(false);
        };

        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [settingsOpen]);

    return (
        <main className="home-layout">
            <section className="hero-copy">
                <div className="hero-kicker">
                    <span className="pulse-ring" aria-hidden="true" />
                    conexão direta entre amigos
                </div>
                <h1>
                    Compartilhe a tela.
                    <span>Fique na call.</span>
                </h1>
                <p className="hero-description">
                    Uma transmissão simples para explicar aquela jogada,
                    mostrar um bug ou acompanhar a partida com a galera.
                </p>
                <div className="capture-settings">
                    <button
                        className="settings-toggle"
                        type="button"
                        onClick={() => setSettingsOpen(current => !current)}
                        aria-expanded={settingsOpen}
                        aria-controls="capture-settings-popover"
                        aria-haspopup="dialog"
                    >
                        <span className="settings-icon" aria-hidden="true">⚙</span>
                        <span className="settings-toggle-copy">
                            <strong>Configurações</strong>
                            <span>{settingsSummary}</span>
                        </span>
                        <span className="settings-toggle-arrow" aria-hidden="true">{settingsOpen ? "⌃" : "⌄"}</span>
                    </button>
                    {settingsOpen && (
                        <div
                            className="settings-popover"
                            id="capture-settings-popover"
                            role="dialog"
                            aria-labelledby="capture-settings-title"
                        >
                            <div className="capture-settings-heading">
                                <div>
                                    <strong id="capture-settings-title">Configurações da transmissão</strong>
                                    <span>Aplicadas quando você iniciar</span>
                                </div>
                                <button
                                    className="settings-close"
                                    type="button"
                                    onClick={() => setSettingsOpen(false)}
                                    aria-label="Fechar configurações"
                                >
                                    ×
                                </button>
                            </div>
                            <div className="capture-settings-fields">
                                <label className="capture-setting">
                                    <span>Fonte da transmissão</span>
                                    <select
                                        value={settings.source}
                                        onChange={event => onSettingsChange(current => ({
                                            ...current,
                                            source: event.target.value as CaptureSettings["source"],
                                        }))}
                                    >
                                        {getAvailableCaptureSourceOptions().map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="capture-setting">
                                    <span>Resolução</span>
                                    <select
                                        value={settings.resolution}
                                        onChange={event => onSettingsChange(current => ({
                                            ...current,
                                            resolution: event.target.value as CaptureSettings["resolution"],
                                        }))}
                                    >
                                        {RESOLUTION_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="capture-setting">
                                    <span>Quadros por segundo</span>
                                    <select
                                        value={settings.fps}
                                        onChange={event => onSettingsChange(current => ({
                                            ...current,
                                            fps: Number(event.target.value) as CaptureSettings["fps"],
                                        }))}
                                    >
                                        {FPS_OPTIONS.map(fps => (
                                            <option key={fps} value={fps}>
                                                {fps} FPS
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="capture-setting">
                                    <span>Bitrate máximo</span>
                                    <select
                                        value={settings.bitrate ?? "auto"}
                                        onChange={event => onSettingsChange(current => ({
                                            ...current,
                                            bitrate: event.target.value === "auto"
                                                ? null
                                                : Number(event.target.value) as CaptureSettings["bitrate"],
                                        }))}
                                    >
                                        {BITRATE_OPTIONS.map(option => (
                                            <option key={option.label} value={option.value ?? "auto"}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {settings.source !== "camera" && <label className="capture-setting">
                                    <span>Áudio da tela</span>
                                    <select
                                        value={settings.audio ? "on" : "off"}
                                        onChange={event => onSettingsChange(current => ({
                                            ...current,
                                            audio: event.target.value === "on",
                                        }))}
                                    >
                                        <option value="on">Ligado</option>
                                        <option value="off">Desligado</option>
                                    </select>
                                </label>
                                }
                                {settings.source !== "screen" && <label className="capture-setting">
                                    <span>Microfone</span>
                                    <select
                                        value={settings.microphone ? "on" : "off"}
                                        onChange={event => onSettingsChange(current => ({
                                            ...current,
                                            microphone: event.target.value === "on",
                                        }))}
                                    >
                                        <option value="on">Ligado</option>
                                        <option value="off">Desligado</option>
                                    </select>
                                </label>}
                                {settings.source !== "camera" && <label className="capture-setting">
                                    <span>Cursor</span>
                                    <select
                                        value={settings.cursor}
                                        onChange={event => onSettingsChange(current => ({
                                            ...current,
                                            cursor: event.target.value as CaptureSettings["cursor"],
                                        }))}
                                    >
                                        {CURSOR_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>}
                            </div>
                            <p className="settings-help">
                                O bitrate é o limite por espectador. Valores maiores usam mais upload.
                            </p>
                        </div>
                    )}
                </div>
                <button className="button button-primary button-large" onClick={() => onStart(settings)}>
                    <span>Iniciar transmissão</span>
                    <span className="button-arrow" aria-hidden="true">↗</span>
                </button>
                <p className="microcopy">
                    <span aria-hidden="true">⌁</span>
                    sem upload · sem login · feito para poucos amigos
                </p>
            </section>

            <aside className="home-visual" aria-label="Como funciona">
                <div className="orb orb-one" />
                <div className="orb orb-two" />
                <div className="visual-card">
                    <div className="visual-card-top">
                        <span className="visual-live"><span /> AO VIVO</span>
                        <span className="visual-time">00:42:18</span>
                    </div>
                    <div className="visual-screen">
                        <div className="screen-glow" />
                        <div className="screen-lines">
                            <span />
                            <span />
                            <span />
                        </div>
                        <div className="screen-chip">P2P</div>
                    </div>
                    <div className="visual-card-bottom">
                        <span>rota direta estabelecida</span>
                        <span className="signal-bars"><i /><i /><i /><i /></span>
                    </div>
                </div>
                <div className="visual-caption">
                    <span className="caption-number">01</span>
                    <span>um link. uma sala.<br />nenhum intermediário no vídeo.</span>
                </div>
            </aside>

            <section className="feature-strip">
                <div className="feature-item">
                    <span className="feature-icon" aria-hidden="true">↗</span>
                    <div>
                        <strong>Compartilhe em segundos</strong>
                        <span>clique, copie, envie</span>
                    </div>
                </div>
                <div className="feature-item">
                    <span className="feature-icon" aria-hidden="true">◌</span>
                    <div>
                        <strong>Vídeo ponto a ponto</strong>
                        <span>WebRTC direto entre vocês</span>
                    </div>
                </div>
                <div className="feature-item">
                    <span className="feature-icon" aria-hidden="true">⌁</span>
                    <div>
                        <strong>Para a sua party</strong>
                        <span>leve e sem complicação</span>
                    </div>
                </div>
            </section>
        </main>
    );
}

function VideoActions({
    videoRef,
    stageRef,
}: {
    videoRef: { current: HTMLVideoElement | null };
    stageRef: { current: HTMLDivElement | null };
}) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isPictureInPicture, setIsPictureInPicture] = useState(false);
    const video = videoRef.current;
    const pictureInPictureAvailable = Boolean(
        document.pictureInPictureEnabled && video && typeof video.requestPictureInPicture === "function",
    );

    useEffect(() => {
        const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
        const syncPictureInPicture = () => setIsPictureInPicture(document.pictureInPictureElement === videoRef.current);
        const currentVideo = videoRef.current;

        document.addEventListener("fullscreenchange", syncFullscreen);
        currentVideo?.addEventListener("enterpictureinpicture", syncPictureInPicture);
        currentVideo?.addEventListener("leavepictureinpicture", syncPictureInPicture);
        syncFullscreen();
        syncPictureInPicture();

        return () => {
            document.removeEventListener("fullscreenchange", syncFullscreen);
            currentVideo?.removeEventListener("enterpictureinpicture", syncPictureInPicture);
            currentVideo?.removeEventListener("leavepictureinpicture", syncPictureInPicture);
        };
    }, [stageRef, videoRef]);

    const toggleFullscreen = async () => {
        const stage = stageRef.current;
        if (!stage || typeof stage.requestFullscreen !== "function") return;

        try {
            if (document.fullscreenElement === stage) {
                await document.exitFullscreen();
            } else {
                await stage.requestFullscreen();
            }
        } catch {
            setIsFullscreen(false);
        }
    };

    const togglePictureInPicture = async () => {
        if (!video || !pictureInPictureAvailable) return;

        try {
            if (document.pictureInPictureElement === video) {
                await document.exitPictureInPicture();
            } else {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                await video.requestPictureInPicture();
            }
        } catch {
            setIsPictureInPicture(false);
        }
    };

    return (
        <div className="video-actions" aria-label="Controles do vídeo">
            <button
                className="video-action"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                aria-pressed={isFullscreen}
                title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
                <span aria-hidden="true">{isFullscreen ? "⤢" : "⛶"}</span>
            </button>
            {pictureInPictureAvailable && (
                <button
                    className="video-action video-action-pip"
                    onClick={() => void togglePictureInPicture()}
                    aria-label={isPictureInPicture ? "Sair do Picture-in-Picture" : "Picture-in-Picture"}
                    aria-pressed={isPictureInPicture}
                    title={isPictureInPicture ? "Sair do Picture-in-Picture" : "Picture-in-Picture"}
                >
                    <span aria-hidden="true">PIP</span>
                </button>
            )}
        </div>
    );
}

interface DisplayChatMessage extends ChatMessage {
    isSelf: boolean;
}

function ChatPanel({
    title,
    messages,
    open,
    unreadCount,
    soundEnabled,
    onToggle,
    onSoundToggle,
    onSend,
    canSend,
    nameValue,
    onNameChange,
    emptyLabel,
}: {
    title: string;
    messages: DisplayChatMessage[];
    open: boolean;
    unreadCount: number;
    soundEnabled: boolean;
    onToggle: () => void;
    onSoundToggle: () => void;
    onSend: (text: string) => void;
    canSend: boolean;
    nameValue?: string;
    onNameChange?: (name: string) => void;
    emptyLabel: string;
}) {
    const [draft, setDraft] = useState("");
    const messagesRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const list = messagesRef.current;
        if (list) list.scrollTop = list.scrollHeight;
    }, [open, messages]);

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text || !canSend) return;

        onSend(text);
        setDraft("");
    };

    return (
        <div className={open ? "chat-widget is-open" : "chat-widget"}>
            {open && (
                <div className="chat-panel" role="dialog" aria-label={title}>
                    <div className="chat-panel-header">
                        <strong>{title}</strong>
                        <div className="chat-panel-header-actions">
                            <button
                                type="button"
                                className="chat-sound-toggle"
                                onClick={onSoundToggle}
                                aria-pressed={soundEnabled}
                                aria-label={soundEnabled ? "Desativar sons do chat" : "Ativar sons do chat"}
                                title={soundEnabled ? "Desativar sons do chat" : "Ativar sons do chat"}
                            >
                                <span aria-hidden="true">{soundEnabled ? "⌁" : "⌁̸"}</span>
                            </button>
                            <button
                                type="button"
                                className="chat-close"
                                onClick={onToggle}
                                aria-label="Fechar chat"
                            >
                                ×
                            </button>
                        </div>
                    </div>
                    {onNameChange && (
                        <label className="chat-name-field">
                            <span>Seu nome (opcional)</span>
                            <input
                                value={nameValue ?? ""}
                                onChange={event => onNameChange(event.target.value)}
                                placeholder="Espectador"
                                maxLength={40}
                            />
                        </label>
                    )}
                    <div className="chat-messages" ref={messagesRef}>
                        {messages.length === 0 && <p className="chat-empty">{emptyLabel}</p>}
                        {messages.map(message => (
                            <div
                                key={message.id}
                                className={
                                    "chat-message"
                                    + (message.isSelf ? " is-self" : "")
                                    + (message.isBroadcaster ? " is-broadcaster" : "")
                                }
                            >
                                <div className="chat-message-meta">
                                    <span className="chat-message-author">
                                        {message.isSelf ? "Você" : message.authorName}
                                    </span>
                                    <span className="chat-message-time">{formatMessageTime(message.timestamp)}</span>
                                </div>
                                <p className="chat-message-text">{message.text}</p>
                            </div>
                        ))}
                    </div>
                    <form className="chat-form" onSubmit={handleSubmit}>
                        <input
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            placeholder={canSend ? "Escreva uma mensagem…" : "Conectando ao chat…"}
                            maxLength={CHAT_MAX_MESSAGE_LENGTH}
                            disabled={!canSend}
                        />
                        <button
                            type="submit"
                            className="chat-send"
                            disabled={!canSend || !draft.trim()}
                            aria-label="Enviar mensagem"
                        >
                            ➤
                        </button>
                    </form>
                </div>
            )}
            <button
                type="button"
                className="chat-toggle"
                onClick={onToggle}
                aria-expanded={open}
                aria-label={open ? "Fechar chat" : "Abrir chat"}
            >
                <span aria-hidden="true">{open ? "×" : "💬"}</span>
                {!open && unreadCount > 0 && (
                    <span className="chat-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
                )}
            </button>
        </div>
    );
}

function BroadcastView() {
    const [mode, setMode] = useState<StreamMode>("idle");
    const [error, setError] = useState<AppError | null>(null);
    const [localStreams, setLocalStreams] = useState<CaptureStreams>(EMPTY_CAPTURE_STREAMS);
    const [captureSettings, setCaptureSettings] = useState<CaptureSettings>(loadCaptureSettings);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [viewerCount, setViewerCount] = useState(0);
    const [copied, setCopied] = useState(false);
    const [audioMuted, setAudioMuted] = useState(false);
    const [chatMessages, setChatMessages] = useState<DisplayChatMessage[]>([]);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatUnread, setChatUnread] = useState(0);
    const [chatSoundEnabled, setChatSoundEnabled] = useState(loadChatSoundEnabled);
    const localScreenVideoRef = useRef<HTMLVideoElement>(null);
    const localCameraVideoRef = useRef<HTMLVideoElement>(null);
    const localStageRef = useRef<HTMLDivElement>(null);
    const localStreamsRef = useRef<CaptureStreams>(EMPTY_CAPTURE_STREAMS);
    const peerRef = useRef<Peer | null>(null);
    const callsRef = useRef<MediaConnection[]>([]);
    const chatConnectionsRef = useRef<DataConnection[]>([]);
    const chatViewerIndexRef = useRef(0);
    const chatOpenRef = useRef(false);
    const chatSoundEnabledRef = useRef(chatSoundEnabled);
    const chatSoundPlayerRef = useRef<ChatNotificationPlayer | null>(null);

    useEffect(() => {
        const player = createChatNotificationPlayer();
        chatSoundPlayerRef.current = player;

        return () => {
            chatSoundPlayerRef.current = null;
            void player.dispose();
        };
    }, []);

    useEffect(() => {
        chatOpenRef.current = chatOpen;
    }, [chatOpen]);

    useEffect(() => {
        chatSoundEnabledRef.current = chatSoundEnabled;
        saveChatSoundEnabled(chatSoundEnabled);
    }, [chatSoundEnabled]);

    const toggleChat = useCallback(() => {
        void chatSoundPlayerRef.current?.unlock();
        setChatOpen(current => {
            const next = !current;
            if (next) setChatUnread(0);
            return next;
        });
    }, []);

    const toggleChatSound = useCallback(() => {
        void chatSoundPlayerRef.current?.unlock();
        setChatSoundEnabled(current => !current);
    }, []);

    const sendBroadcastChatMessage = useCallback((text: string) => {
        const sanitized = sanitizeChatText(text);
        if (!sanitized) return;

        const message = buildChatMessage({ text: sanitized, authorName: "Transmissor", isBroadcaster: true });
        setChatMessages(current => [...current, { ...message, isSelf: true }]);
        chatConnectionsRef.current.forEach(conn => {
            if (conn.open) conn.send(message);
        });
    }, []);

    const updateViewerCount = useCallback(() => {
        setViewerCount(new Set(callsRef.current.map(call => call.peer)).size);
    }, []);

    const stopBroadcast = useCallback(() => {
        const peer = peerRef.current;
        peerRef.current = null;

        callsRef.current.forEach(call => call.close());
        callsRef.current = [];
        chatConnectionsRef.current.forEach(conn => conn.close());
        chatConnectionsRef.current = [];
        chatViewerIndexRef.current = 0;
        stopCaptureStreams(localStreamsRef.current);
        localStreamsRef.current = EMPTY_CAPTURE_STREAMS;

        peer?.destroy();
        setLocalStreams(EMPTY_CAPTURE_STREAMS);
        setShareUrl(null);
        setViewerCount(0);
        setCopied(false);
        setAudioMuted(false);
        setChatMessages([]);
        setChatOpen(false);
        setChatUnread(0);
        setMode("idle");
    }, []);

    const startBroadcast = useCallback(async (settings: CaptureSettings = captureSettings) => {
        setMode("starting");
        setError(null);
        setCopied(false);
        setCaptureSettings(settings);
        setAudioMuted(false);

        const nextStreams: CaptureStreams = { ...EMPTY_CAPTURE_STREAMS };
        try {
            const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
            if (!window.isSecureContext && !isLocalhost) {
                throw new TypeError("Media capture requires a secure context");
            }

            const sources = getCaptureSources(settings.source);
            if (sources.includes("screen") && !navigator.mediaDevices?.getDisplayMedia) {
                throw new TypeError("Screen capture is not supported");
            }
            if (sources.includes("camera") && !navigator.mediaDevices?.getUserMedia) {
                throw new TypeError("Camera capture is not supported");
            }

            if (sources.includes("screen")) {
                nextStreams.screen = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions(settings));
            }
            if (sources.includes("camera")) {
                nextStreams.camera = await navigator.mediaDevices.getUserMedia(buildCameraMediaOptions(settings));
            }

            localStreamsRef.current = nextStreams;
            setLocalStreams(nextStreams);
            setCaptureAudioEnabled(Object.values(nextStreams), true);

            const peer = createPeer(loadBroadcastId() ?? undefined);
            peerRef.current = peer;

            Object.values(nextStreams).forEach(stream => {
                stream?.getVideoTracks()[0]?.addEventListener("ended", stopBroadcast, { once: true });
            });

            peer.on("open", id => {
                saveBroadcastId(id);
                setShareUrl(buildWatchUrl(window.location.origin, window.location.pathname, id));
                setMode("broadcasting");
            });

            peer.on("call", call => {
                const requestedSource = call.metadata?.source === "camera" ? "camera" : "screen";
                const stream = getStreamForSource(localStreamsRef.current, requestedSource);
                if (!stream) {
                    call.close();
                    return;
                }

                const viewerIdentity = getMediaConnectionIdentity(call.peer, call.metadata);
                const activeCallsForViewer = callsRef.current.filter(activeCall =>
                    getMediaConnectionIdentity(activeCall.peer, activeCall.metadata) === viewerIdentity,
                );
                const viewerSessionId = getMediaConnectionSessionId(call.peer, call.metadata);
                const anotherSessionIsActive = activeCallsForViewer.some(activeCall =>
                    getMediaConnectionSessionId(activeCall.peer, activeCall.metadata) !== viewerSessionId,
                );
                if (anotherSessionIsActive || activeCallsForViewer.length >= MAX_MEDIA_CONNECTIONS_PER_SESSION) {
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
                call.on("close", () => {
                    removeCall();
                });
                call.on("error", () => {
                    removeCall();
                });

                call.answer(stream);
                void applyVideoBitrate(call, settings.bitrate).catch(() => undefined);
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
                    setChatMessages(current => [...current, { ...message, isSelf: false }]);
                    setChatUnread(current => (chatOpenRef.current ? current : current + 1));
                    if (shouldPlayChatNotification(chatOpenRef.current, chatSoundEnabledRef.current)) {
                        void chatSoundPlayerRef.current?.play();
                    }

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
                stopBroadcast();
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
            stopBroadcast();
            setError(getMediaError(captureError, settings.source));
            setMode("error");
        }
    }, [captureSettings, stopBroadcast, updateViewerCount]);

    useEffect(() => {
        const videoBindings = [
            [localScreenVideoRef.current, localStreams.screen],
            [localCameraVideoRef.current, localStreams.camera],
        ] as const;
        videoBindings.forEach(([video, stream]) => {
            if (video) video.srcObject = stream;
        });

        return () => {
            videoBindings.forEach(([video]) => {
                if (video) video.srcObject = null;
            });
        };
    }, [localStreams]);

    useEffect(() => {
        saveCaptureSettings(captureSettings);
    }, [captureSettings]);

    useEffect(() => stopBroadcast, [stopBroadcast]);

    const toggleBroadcastAudio = () => {
        const nextMuted = !audioMuted;
        setCaptureAudioEnabled(Object.values(localStreamsRef.current), !nextMuted);
        setAudioMuted(nextMuted);
    };

    const flipCamera = async () => {
        const cameraStream = localStreamsRef.current.camera;
        if (!cameraStream) return;

        const nextFacing: CaptureSettings["cameraFacing"] = captureSettings.cameraFacing === "environment" ? "user" : "environment";

        try {
            const replacementStream = await navigator.mediaDevices.getUserMedia({
                video: buildCameraVideoConstraints({ ...captureSettings, cameraFacing: nextFacing }),
                audio: false,
            });
            const newVideoTrack = replacementStream.getVideoTracks()[0];
            if (!newVideoTrack) return;

            newVideoTrack.addEventListener("ended", stopBroadcast, { once: true });

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

            setCaptureSettings(current => ({ ...current, cameraFacing: nextFacing }));
        } catch (flipError) {
            setError(getMediaError(flipError, "camera"));
        }
    };

    const copyShareUrl = async () => {
        if (!shareUrl) return;

        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
        } catch {
            setError({
                title: "Não foi possível copiar",
                message: "Selecione e copie o link manualmente.",
            });
        }
    };

    if (mode === "idle" || mode === "error") {
        return (
            <div className="page-shell">
                <AppHeader />
                <HomeView
                    settings={captureSettings}
                    onSettingsChange={setCaptureSettings}
                    onStart={startBroadcast}
                />
                {error && (
                    <div className="floating-error">
                        <ErrorCard error={error} onRetry={startBroadcast} onHome={goHome} />
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="page-shell">
            <AppHeader eyebrow="TRANSMISSOR" />
            <main className="room-layout">
                <div className="room-heading">
                    <div>
                        <div className="section-kicker">sua transmissão</div>
                        <h1>Mostre o que está acontecendo.</h1>
                        <p className="section-description">
                            Mantenha esta aba aberta enquanto seus amigos entram pelo link.
                        </p>
                    </div>
                    <StatusPill mode={mode} />
                </div>

                <div className="room-grid">
                    <section className="video-card">
                        <div className="video-card-header">
                            <span className="capture-summary">prévia local · {formatCaptureSettings(captureSettings)}</span>
                            <span className="viewer-count"><span className="viewer-icon">◉</span>{viewerCount} {viewerCount === 1 ? "pessoa" : "pessoas"} assistindo</span>
                        </div>
                        <div className="video-stage-shell" ref={localStageRef}>
                            <div className={localStreams.screen && localStreams.camera ? "video-stage has-multiple-media" : "video-stage"}>
                                {localStreams.screen && (
                                    <video className="capture-video capture-video-screen" ref={localScreenVideoRef} autoPlay playsInline muted />
                                )}
                                {localStreams.camera && (
                                    <video className="capture-video capture-video-camera" ref={localCameraVideoRef} autoPlay playsInline muted />
                                )}
                                {!localStreams.screen && !localStreams.camera && (
                                    <div className="video-placeholder">
                                        <span className="placeholder-mark">◌</span>
                                        <span>Aguardando o compartilhamento…</span>
                                    </div>
                                )}
                                {(localStreams.screen || localStreams.camera) && (
                                    <VideoActions
                                        videoRef={localStreams.screen ? localScreenVideoRef : localCameraVideoRef}
                                        stageRef={localStageRef}
                                    />
                                )}
                                {localStreams.camera && (
                                    <div className="video-actions-top" aria-label="Controles da câmera">
                                        <button
                                            className="video-action"
                                            onClick={() => void flipCamera()}
                                            aria-label="Inverter câmera"
                                            title={captureSettings.cameraFacing === "environment" ? "Usar câmera frontal" : "Usar câmera traseira"}
                                        >
                                            <span aria-hidden="true">⟲</span>
                                        </button>
                                    </div>
                                )}
                                {(localStreams.screen?.getAudioTracks().length || localStreams.camera?.getAudioTracks().length) ? (
                                    <button
                                        className="audio-unlock local-audio-toggle"
                                        onClick={toggleBroadcastAudio}
                                        aria-pressed={!audioMuted}
                                    >
                                        <span aria-hidden="true">◖</span> {audioMuted ? "Ativar áudio" : "Mutar áudio"}
                                    </button>
                                ) : null}
                                <span className="stage-live-badge"><span /> LOCAL</span>
                            </div>
                            <ChatPanel
                                title="Chat com espectadores"
                                messages={chatMessages}
                                open={chatOpen}
                                unreadCount={chatUnread}
                                soundEnabled={chatSoundEnabled}
                                onToggle={toggleChat}
                                onSoundToggle={toggleChatSound}
                                onSend={sendBroadcastChatMessage}
                                canSend
                                emptyLabel="Nenhuma mensagem ainda. Diga oi para quem está assistindo."
                            />
                        </div>
                    </section>

                    <aside className="share-card">
                        <div>
                            <div className="section-kicker">convide a galera</div>
                            <h2>O link é a sala.</h2>
                            <p>Envie para quem vai assistir. Quando você encerrar, ele deixa de funcionar.</p>
                        </div>
                        <div className="share-link-box">
                            <span>{shareUrl ?? "gerando seu link…"}</span>
                            <button onClick={copyShareUrl} disabled={!shareUrl} aria-label="Copiar link da transmissão">
                                {copied ? "✓" : "⧉"}
                            </button>
                        </div>
                        <button className="button button-primary share-button" onClick={copyShareUrl} disabled={!shareUrl}>
                            <span>{copied ? "Link copiado" : "Copiar link"}</span>
                            <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
                        </button>
                        <div className="share-tip">
                            <span className="tip-icon">i</span>
                            <span>O vídeo vai direto para seus amigos. Esta página só entrega o link.</span>
                        </div>
                    </aside>
                </div>

                {error && <ErrorCard error={error} onHome={goHome} />}

                <div className="room-footer">
                    <span><span className="secure-icon">⌁</span> conexão WebRTC criptografada</span>
                    <button className="text-button stop-button" onClick={stopBroadcast}>
                        Encerrar transmissão <span aria-hidden="true">×</span>
                    </button>
                </div>
            </main>
        </div>
    );
}

function ViewerView({ broadcastId }: { broadcastId: string }) {
    const [mode, setMode] = useState<StreamMode>("connecting");
    const [error, setError] = useState<AppError | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>(EMPTY_CAPTURE_STREAMS);
    const [audioOn, setAudioOn] = useState(false);
    const [volume, setVolume] = useState(loadViewerVolume);
    const [chatMessages, setChatMessages] = useState<DisplayChatMessage[]>([]);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatUnread, setChatUnread] = useState(0);
    const [chatSoundEnabled, setChatSoundEnabled] = useState(loadChatSoundEnabled);
    const [chatReady, setChatReady] = useState(false);
    const [viewerName, setViewerName] = useState(loadViewerName);
    const remoteScreenVideoRef = useRef<HTMLVideoElement>(null);
    const remoteCameraVideoRef = useRef<HTMLVideoElement>(null);
    const remoteStageRef = useRef<HTMLDivElement>(null);
    const peerRef = useRef<Peer | null>(null);
    const mediaCallsRef = useRef<Partial<Record<CaptureTrackSource, MediaConnection>>>({});
    const negotiationsRef = useRef<Partial<Record<CaptureTrackSource, NegotiationStream>>>({});
    const pendingMediaSourcesRef = useRef(new Set<CaptureTrackSource>());
    const receivedMediaSourcesRef = useRef(new Set<CaptureTrackSource>());
    const chatConnRef = useRef<DataConnection | null>(null);
    const chatOpenRef = useRef(false);
    const chatSoundEnabledRef = useRef(chatSoundEnabled);
    const chatSoundPlayerRef = useRef<ChatNotificationPlayer | null>(null);
    const viewerNameRef = useRef(viewerName);

    useEffect(() => {
        const player = createChatNotificationPlayer();
        chatSoundPlayerRef.current = player;

        return () => {
            chatSoundPlayerRef.current = null;
            void player.dispose();
        };
    }, []);

    useEffect(() => {
        chatOpenRef.current = chatOpen;
    }, [chatOpen]);

    useEffect(() => {
        chatSoundEnabledRef.current = chatSoundEnabled;
        saveChatSoundEnabled(chatSoundEnabled);
    }, [chatSoundEnabled]);

    useEffect(() => {
        viewerNameRef.current = viewerName;
    }, [viewerName]);

    useEffect(() => {
        saveViewerVolume(volume);
    }, [volume]);

    const toggleChat = useCallback(() => {
        void chatSoundPlayerRef.current?.unlock();
        setChatOpen(current => {
            const next = !current;
            if (next) setChatUnread(0);
            return next;
        });
    }, []);

    const toggleChatSound = useCallback(() => {
        void chatSoundPlayerRef.current?.unlock();
        setChatSoundEnabled(current => !current);
    }, []);

    const changeViewerName = useCallback((name: string) => {
        setViewerName(name);
        saveViewerName(name);
    }, []);

    const sendViewerChatMessage = useCallback((text: string) => {
        const sanitized = sanitizeChatText(text);
        const conn = chatConnRef.current;
        if (!sanitized || !conn?.open) return;

        const name = viewerNameRef.current.trim();
        conn.send({ text: sanitized, name: name || undefined });
        const message = buildChatMessage({ text: sanitized, authorName: name || "Você", isBroadcaster: false });
        setChatMessages(current => [...current, { ...message, isSelf: true }]);
    }, []);

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
        peer?.destroy();
        setRemoteStreams(EMPTY_CAPTURE_STREAMS);
        setChatMessages([]);
        setChatOpen(false);
        setChatUnread(0);
        setChatReady(false);
    }, []);

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
                        setRemoteStreams(current => ({ ...current, [source]: null }));

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
                            setRemoteStreams(current => ({ ...current, [source]: stream }));
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

                        setChatMessages(current => [...current, { ...message, isSelf: false }]);
                        setChatUnread(current => (chatOpenRef.current ? current : current + 1));
                        if (shouldPlayChatNotification(chatOpenRef.current, chatSoundEnabledRef.current)) {
                            void chatSoundPlayerRef.current?.play();
                        }
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
    }, [broadcastId, cleanup]);

    useEffect(() => {
        connect();
        return cleanup;
    }, [connect, cleanup]);

    useEffect(() => {
        const videoBindings = [
            [remoteScreenVideoRef.current, remoteStreams.screen],
            [remoteCameraVideoRef.current, remoteStreams.camera],
        ] as const;
        videoBindings.forEach(([video, stream]) => {
            if (!video) return;
            video.srcObject = stream;
            video.muted = !audioOn;
            video.volume = volume;
            if (stream) void video.play().catch(() => undefined);
        });

        return () => {
            videoBindings.forEach(([video]) => {
                if (video) video.srcObject = null;
            });
        };
    }, [audioOn, volume, remoteStreams]);

    const toggleAudio = () => {
        const nextAudioOn = !audioOn;
        [remoteScreenVideoRef.current, remoteCameraVideoRef.current].forEach(video => {
            if (video) video.muted = !nextAudioOn;
        });
        setAudioOn(nextAudioOn);
        if (nextAudioOn) {
            [remoteScreenVideoRef.current, remoteCameraVideoRef.current].forEach(video => {
                if (video) void video.play().catch(() => undefined);
            });
        }
    };

    const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
        const nextVolume = Number(event.target.value) / 100;
        setVolume(nextVolume);
        [remoteScreenVideoRef.current, remoteCameraVideoRef.current].forEach(video => {
            if (video) video.volume = nextVolume;
        });

        if (!audioOn) {
            setAudioOn(true);
            [remoteScreenVideoRef.current, remoteCameraVideoRef.current].forEach(video => {
                if (video) {
                    video.muted = false;
                    void video.play().catch(() => undefined);
                }
            });
        }
    };

    return (
        <div className="page-shell">
            <AppHeader eyebrow="ESPECTADOR" />
            <main className="room-layout viewer-layout">
                <div className="room-heading">
                    <div>
                        <div className="section-kicker">sala compartilhada</div>
                        <h1>Você entrou na transmissão.</h1>
                        <p className="section-description">A imagem vem direto do navegador do seu amigo.</p>
                    </div>
                    <StatusPill mode={mode} />
                </div>

                <section className="video-card viewer-video-card">
                    <div className="video-card-header">
                        <span>transmissão ao vivo</span>
                        <span className="viewer-count">conexão ponto a ponto</span>
                    </div>
                    <div className="video-stage-shell" ref={remoteStageRef}>
                        <div className={remoteStreams.screen && remoteStreams.camera ? "video-stage viewer-stage has-multiple-media" : "video-stage viewer-stage"}>
                            {remoteStreams.screen && (
                                <video className="capture-video capture-video-screen" ref={remoteScreenVideoRef} autoPlay playsInline />
                            )}
                            {remoteStreams.camera && (
                                <video className="capture-video capture-video-camera" ref={remoteCameraVideoRef} autoPlay playsInline />
                            )}
                            {!remoteStreams.screen && !remoteStreams.camera && mode !== "error" && (
                                <div className="video-placeholder">
                                    <span className="loader" />
                                    <span>{MODE_LABELS[mode]}…</span>
                                </div>
                            )}
                            {(remoteStreams.screen || remoteStreams.camera) && (
                                <div className="audio-control">
                                    <div className="volume-popover">
                                        <input
                                            type="range"
                                            className="volume-slider"
                                            min={0}
                                            max={100}
                                            value={Math.round(volume * 100)}
                                            onChange={handleVolumeChange}
                                            aria-label="Volume da transmissão"
                                        />
                                        <span className="volume-value">{Math.round(volume * 100)}%</span>
                                    </div>
                                    <button
                                        className="audio-unlock"
                                        onClick={toggleAudio}
                                        aria-pressed={audioOn}
                                    >
                                        <span aria-hidden="true">◖</span> {audioOn ? "Mutar áudio" : "Ativar áudio"}
                                    </button>
                                </div>
                            )}
                            {(remoteStreams.screen || remoteStreams.camera) && (
                                <VideoActions
                                    videoRef={remoteStreams.screen ? remoteScreenVideoRef : remoteCameraVideoRef}
                                    stageRef={remoteStageRef}
                                />
                            )}
                            {(remoteStreams.screen || remoteStreams.camera) && <span className="stage-live-badge"><span /> AO VIVO</span>}
                        </div>
                        <ChatPanel
                            title="Chat com quem está assistindo"
                            messages={chatMessages}
                            open={chatOpen}
                            unreadCount={chatUnread}
                            soundEnabled={chatSoundEnabled}
                            onToggle={toggleChat}
                            onSoundToggle={toggleChatSound}
                            onSend={sendViewerChatMessage}
                            canSend={chatReady}
                            nameValue={viewerName}
                            onNameChange={changeViewerName}
                            emptyLabel="Nenhuma mensagem ainda. Mande um oi."
                        />
                    </div>
                </section>

                {error && <ErrorCard error={error} onRetry={connect} onHome={goHome} />}

                <div className="room-footer">
                    <span><span className="secure-icon">⌁</span> conexão WebRTC criptografada</span>
                    <button className="text-button stop-button" onClick={goHome}>
                        Sair da sala <span aria-hidden="true">×</span>
                    </button>
                </div>
            </main>
        </div>
    );
}

const ANDROID_BANNER_DISMISSED_KEY = "p2pcast.android-banner-dismissed";

function isAndroidUserAgent(): boolean {
    return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

function AndroidAppBanner() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!isAndroidUserAgent()) return;

        try {
            if (window.localStorage.getItem(ANDROID_BANNER_DISMISSED_KEY) === "1") return;
        } catch {
            // Storage can be unavailable in private browsing or restrictive contexts.
        }

        setVisible(true);
    }, []);

    const dismiss = () => {
        setVisible(false);
        try {
            window.localStorage.setItem(ANDROID_BANNER_DISMISSED_KEY, "1");
        } catch {
            // Storage can be unavailable in private browsing or restrictive contexts.
        }
    };

    if (!visible) return null;

    return (
        <div className="android-app-banner" role="banner">
            <span className="android-app-banner-icon" aria-hidden="true">📲</span>
            <div className="android-app-banner-copy">
                <strong>Use o app Android</strong>
                <span>Transmita em segundo plano, sem depender do navegador.</span>
            </div>
            <a className="android-app-banner-cta" href="/downloads/p2pcast.apk" download>
                Baixar app
            </a>
            <button
                type="button"
                className="android-app-banner-close"
                onClick={dismiss}
                aria-label="Fechar aviso"
            >
                ×
            </button>
        </div>
    );
}

export default function App() {
    const broadcastId = parseWatchId(window.location.search);

    return (
        <>
            <AndroidAppBanner />
            {broadcastId ? <ViewerView broadcastId={broadcastId} /> : <BroadcastView />}
        </>
    );
}
