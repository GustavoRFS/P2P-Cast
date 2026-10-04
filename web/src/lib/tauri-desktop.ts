import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

const SYSTEM_WINDOW_SOURCE_ID = "tauri:system-window-picker";
const OAUTH_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type TauriDesktopConfig = {
    backendUrl: string;
    webUrl: string;
    isolatedAudioAvailable: false;
    capturePicker: "system-window";
};

function parseAuthCode(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "p2pcast-tauri:" || url.hostname !== "auth" || url.pathname !== "/callback") return null;
        const code = url.searchParams.get("code");
        return code && OAUTH_CODE_PATTERN.test(code) ? code : null;
    } catch {
        return null;
    }
}

export async function initializeTauriDesktopBridge(): Promise<void> {
    if (!isTauri()) return;

    const cleanExpiredLoginVerifier = () => {
        void invoke("cleanup_login_verifier").catch(error => {
            console.error("Could not clean an expired Tauri login verifier:", error);
        });
    };
    cleanExpiredLoginVerifier();
    window.setInterval(cleanExpiredLoginVerifier, 60_000);

    const authCallbacks = new Set<(code: string) => void>();
    const receivedAuthCodes = new Set<string>();
    let pendingAuthCode: string | null = null;
    const deliverAuthCode = (rawUrl: string) => {
        const code = parseAuthCode(rawUrl);
        if (!code || receivedAuthCodes.has(code)) return;
        receivedAuthCodes.add(code);
        if (receivedAuthCodes.size > 8) {
            const oldest = receivedAuthCodes.values().next().value;
            if (oldest) receivedAuthCodes.delete(oldest);
        }
        if (authCallbacks.size === 0) {
            pendingAuthCode = code;
            return;
        }
        for (const callback of [...authCallbacks]) callback(code);
    };

    window.p2pcastDesktop = Object.freeze({
        getWindowSources: async () => [{
            id: SYSTEM_WINDOW_SOURCE_ID,
            name: "Escolher janela ao iniciar a transmissão",
            thumbnailDataUrl: "",
        }],
        selectWindow: async (sourceId: string) => {
            if (sourceId !== SYSTEM_WINDOW_SOURCE_ID) throw new TypeError("Invalid system window picker id");
        },
        getConfig: async () => {
            const config = await invoke<TauriDesktopConfig>("desktop_config");
            return {
                ...config,
                host: "tauri" as const,
                appOrigin: window.location.origin,
            };
        },
        loginWithDiscord: async (codeChallenge: string) => {
            if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new TypeError("Invalid login challenge");
            await invoke("open_discord_login", { codeChallenge });
        },
        getSavedSession: () => invoke<DesktopSavedSession | null>("get_saved_session"),
        saveSession: (session: DesktopSavedSession) => invoke<void>("save_session", { session }),
        clearSession: () => invoke<void>("clear_session"),
        getLoginVerifier: () => invoke<string | null>("get_login_verifier"),
        saveLoginVerifier: (verifier: string) => invoke<void>("save_login_verifier", { verifier }),
        clearLoginVerifier: () => invoke<void>("clear_login_verifier"),
        onAuthCallback: (callback: (code: string) => void) => {
            authCallbacks.add(callback);
            if (pendingAuthCode) {
                const code = pendingAuthCode;
                pendingAuthCode = null;
                queueMicrotask(() => {
                    if (authCallbacks.has(callback)) callback(code);
                });
            }
            return () => authCallbacks.delete(callback);
        },
        startApplicationAudio: async () => {
            throw new Error("Áudio isolado do aplicativo não está disponível no host Tauri.");
        },
        resumeApplicationAudio: async () => undefined,
        stopApplicationAudio: async () => undefined,
        onApplicationAudioData: () => () => undefined,
        onApplicationAudioError: () => () => undefined,
    });

    try {
        await onOpenUrl(urls => urls.forEach(deliverAuthCode));
    } catch (error) {
        console.error("Could not subscribe to Tauri deep links:", error);
    }
    try {
        const currentUrls = await getCurrent();
        currentUrls?.forEach(deliverAuthCode);
    } catch (error) {
        console.error("Could not read the startup Tauri deep link:", error);
    }
}
