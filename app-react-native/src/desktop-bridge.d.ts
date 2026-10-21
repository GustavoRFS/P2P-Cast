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
    }

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
                capturePicker: "window-list" | "system-window";
            }>;
            copyShareLink?(link: string): Promise<void>;
            showLiveToast?(toast: DesktopLiveToast): Promise<void>;
            getReadyUpdate?(): Promise<DesktopUpdate | null>;
            /** Closes the app; the installer reopens it on the new version. */
            installUpdate?(): Promise<void>;
            onUpdateReady?(listener: (update: DesktopUpdate) => void): () => void;
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
        };
    }
}
