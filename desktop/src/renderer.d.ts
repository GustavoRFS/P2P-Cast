export {};

declare global {
    interface DesktopWindowSource {
        id: string;
        name: string;
        thumbnailDataUrl: string;
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

    interface Window {
        p2pcastDesktop?: {
            getWindowSources(): Promise<DesktopWindowSource[]>;
            selectWindow(sourceId: string): Promise<void>;
            getConfig(): Promise<{
                host: "electron" | "tauri";
                backendUrl: string;
                webUrl: string;
                appOrigin: string;
                isolatedAudioAvailable: boolean;
                capturePicker: "window-list" | "system-window";
            }>;
            loginWithDiscord(codeChallenge: string): Promise<void>;
            getSavedSession(): Promise<DesktopSavedSession | null>;
            saveSession(session: DesktopSavedSession): Promise<void>;
            clearSession(): Promise<void>;
            getLoginVerifier(): Promise<string | null>;
            saveLoginVerifier(verifier: string): Promise<void>;
            clearLoginVerifier(): Promise<void>;
            onAuthCallback(listener: (code: string) => void): () => void;
            // These methods are Electron-only. The Tauri bridge rejects app audio and returns no audio events.
            startApplicationAudio(sourceId: string): Promise<{
                captureId: string;
                format: DesktopApplicationAudioFormat;
            }>;
            resumeApplicationAudio(captureId: string): Promise<void>;
            stopApplicationAudio(captureId: string): Promise<void>;
            onApplicationAudioData(captureId: string, listener: (chunk: ArrayBuffer) => void): () => void;
            onApplicationAudioError(captureId: string, listener: (message: string) => void): () => void;
        };
    }
}
