export {};

declare global {
    interface DesktopWindowSource {
        id: string;
        name: string;
        thumbnailDataUrl: string;
    }

    interface DesktopCaptureTarget {
        id: string;
        selector: string;
        kind: "window" | "monitor";
        name: string;
        processId?: number;
        thumbnailDataUrl?: string;
    }

    interface DesktopShortcutRegistration {
        id: string;
        shortcut: string;
    }

    interface DesktopShortcutRegistrationResult {
        id: string;
        ok: boolean;
        error?: "invalid" | "duplicate" | "unavailable";
    }

    interface DesktopAccountProfile {
        id: string;
        username: string;
        avatar: string | null;
    }

    interface DesktopSavedSession {
        token: string;
        user: DesktopAccountProfile;
    }

    interface DesktopPresenceUser extends DesktopAccountProfile {
        peerId: string;
        activity: string | null;
    }

    interface DesktopApplicationAudioFormat {
        sampleRate: 48000;
        channels: 2;
        format: "f32le";
    }

    /** A signed desktop update, already downloaded and waiting to be installed. */
    interface DesktopUpdate {
        version: string;
        notes: string | null;
    }

    interface DesktopLiveToast {
        id: number;
        userId: string;
        username: string;
        avatar: string | null;
        peerId: string;
        corner: "top-right" | "bottom-right" | "top-left" | "bottom-left";
        /** From "Prever notificação": a click only dismisses it. */
        preview?: boolean;
        /** An app message (updates) instead of a live: `username` is the title, shown with the app icon. */
        message?: string;
    }

    /** What the updater reports after "Verificar atualizações" in the tray. */
    interface DesktopUpdateNotice {
        title: string;
        message: string;
    }

    /** A direct-capture live sent by the app itself, encoded once for every viewer. */
    interface DesktopNativeBroadcastRequest {
        /** The saved broadcast id, so links shared earlier keep working. */
        peerId: string | null;
        videoSourceId: string;
        /** "system" or a window target; null for no audio. */
        audioSourceId: string | null;
        fps: number;
        cursor: "always" | "motion" | "never";
        /** The profile's resolution as a bounding box; 0 keeps the window's size. */
        maxWidth: number;
        maxHeight: number;
        bitrate: number | null;
        softwareEncoder?: boolean;
    }

    /** A running native live moved to another capture and settings; viewers stay connected. */
    interface DesktopNativeCaptureSwitch {
        videoSourceId: string;
        audioSourceId: string | null;
        fps: number;
        cursor: "always" | "motion" | "never";
        maxWidth: number;
        maxHeight: number;
        bitrate: number | null;
    }

    interface DesktopChatMessage {
        id: string;
        authorName: string;
        text: string;
        timestamp: number;
        isBroadcaster: boolean;
    }

    type DesktopNativeBroadcastEvent =
        | { type: "viewers"; count: number }
        | { type: "chat"; message: DesktopChatMessage }
        | { type: "encoder"; name: string; hardware: boolean; width: number; height: number; fps: number; bitrate: number }
        | { type: "signalingLost" }
        | { type: "signalingRestored" }
        | { type: "fatal"; message: string };

    interface Window {
        p2pcastDesktop?: {
            getWindowSources(): Promise<DesktopWindowSource[]>;
            listCaptureTargets?(): Promise<DesktopCaptureTarget[]>;
            resolveCaptureTarget?(selector: string): Promise<DesktopCaptureTarget | null>;
            registerShortcutProfiles?(profiles: DesktopShortcutRegistration[]): Promise<DesktopShortcutRegistrationResult[]>;
            onShortcutProfile?(listener: (profileId: string) => void): () => void;
            selectWindow(sourceId: string): Promise<void>;
            getConfig(): Promise<{
                host: "electron" | "tauri";
                backendUrl: string;
                webUrl: string;
                appOrigin: string;
                isolatedAudioAvailable: boolean;
                directVideoCaptureAvailable?: boolean;
                nativeBroadcastAvailable?: boolean;
                capturePicker: "window-list" | "system-window";
            }>;
            copyShareLink?(link: string): Promise<void>;
            showLiveToast?(toast: DesktopLiveToast): Promise<void>;
            getReadyUpdate?(): Promise<DesktopUpdate | null>;
            /** Closes the app; the installer reopens it on the new version. */
            installUpdate?(): Promise<void>;
            onUpdateReady?(listener: (update: DesktopUpdate) => void): () => void;
            onUpdateNotice?(listener: (notice: DesktopUpdateNotice) => void): () => void;
            loginWithDiscord(codeChallenge: string): Promise<void>;
            getSavedSession(): Promise<DesktopSavedSession | null>;
            saveSession(session: DesktopSavedSession): Promise<void>;
            clearSession(): Promise<void>;
            getLoginVerifier(): Promise<string | null>;
            saveLoginVerifier(verifier: string): Promise<void>;
            clearLoginVerifier(): Promise<void>;
            onAuthCallback(listener: (code: string) => void): () => void;
            notifyLiveStarted?(notification: { username: string; peerId: string }): Promise<void>;
            onNotificationWatch?(listener: (peerId: string) => void): () => void;
            startApplicationAudio(sourceId: string): Promise<{
                captureId: string;
                format: DesktopApplicationAudioFormat;
            }>;
            resumeApplicationAudio(captureId: string): Promise<void>;
            stopApplicationAudio(captureId: string): Promise<void>;
            onApplicationAudioData(captureId: string, listener: (chunk: ArrayBuffer) => void): () => void;
            onApplicationAudioError(captureId: string, listener: (message: string) => void): () => void;
            startDirectVideoCapture?(sourceId: string, settings: {
                fps: number;
                cursor: "always" | "motion" | "never";
            }): Promise<{ captureId: string; width: number; height: number; format: "rgba8" }>;
            resumeDirectVideoCapture?(captureId: string): Promise<void>;
            acknowledgeDirectVideoFrame?(captureId: string): Promise<void>;
            stopDirectVideoCapture?(captureId: string): Promise<void>;
            onDirectVideoFrame?(captureId: string, listener: (frame: { buffer: ArrayBuffer; width: number; height: number }) => void): () => void;
            onDirectVideoError?(captureId: string, listener: (message: string) => void): () => void;
            /** Resolves once viewers can join, with the broadcast id the signaling server accepted. */
            startNativeBroadcast?(request: DesktopNativeBroadcastRequest): Promise<{ peerId: string }>;
            stopNativeBroadcast?(): Promise<void>;
            /** Resolves with a warning when the switch happened without the new audio. */
            switchNativeCapture?(request: DesktopNativeCaptureSwitch): Promise<string | null>;
            sendNativeChat?(message: DesktopChatMessage): Promise<void>;
            setNativeAudioMuted?(muted: boolean): Promise<void>;
            onNativeBroadcastEvent?(listener: (event: DesktopNativeBroadcastEvent) => void): () => void;
        };
    }
}
