import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

const OAUTH_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type TauriDesktopConfig = {
    backendUrl: string;
    webUrl: string;
    isolatedAudioAvailable: boolean;
    directVideoCaptureAvailable: boolean;
    nativeBroadcastAvailable: boolean;
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
    const shortcutCallbacks = new Set<(profileId: string) => void>();
    const audioListenersReady = new Map<string, Promise<void>[]>();
    const directVideoFrameListeners = new Map<string, Set<(frame: { buffer: ArrayBuffer; width: number; height: number }) => void>>();
    const directVideoErrorListeners = new Map<string, Set<(message: string) => void>>();
    const receivedAuthCodes = new Set<string>();
    let pendingAuthCode: string | null = null;
    const acceptAuthCode = (code: string | null) => {
        if (!code || !OAUTH_CODE_PATTERN.test(code) || receivedAuthCodes.has(code)) return;
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
    const deliverAuthCode = (rawUrl: string) => acceptAuthCode(parseAuthCode(rawUrl));

    // The loopback listener started by open_discord_login hands the code over as an event; the
    // p2pcast-tauri:// deep link stays as the path for backends without loopback support.
    void listen<string>("desktop-auth-code", event => acceptAuthCode(event.payload)).catch(error => {
        console.error("Could not subscribe to the login listener:", error);
    });

    const webview2 = (window as Window & {
        chrome?: {
            webview?: {
                addEventListener: (name: string, callback: (event: Event & {
                    additionalData?: unknown;
                    getBuffer(): ArrayBuffer;
                }) => void) => void;
                releaseBuffer: (buffer: ArrayBuffer) => void;
            };
        };
    }).chrome?.webview;
    webview2?.addEventListener("sharedbufferreceived", event => {
        const metadata = event.additionalData as { type?: unknown; captureId?: unknown; width?: unknown; height?: unknown } | undefined;
        if (metadata?.type !== "p2pcast-frame" || typeof metadata.captureId !== "string") return;
        const frameBuffer = event.getBuffer();
        try {
            if (typeof metadata.width === "number" && typeof metadata.height === "number") {
                for (const callback of [...(directVideoFrameListeners.get(metadata.captureId) ?? [])]) {
                    callback({ buffer: frameBuffer, width: metadata.width, height: metadata.height });
                }
            }
        } catch (error) {
            window.dispatchEvent(new CustomEvent("p2pcast:direct-video-error", {
                detail: error instanceof Error ? error.message : "Could not render a captured video frame.",
            }));
        } finally {
            webview2.releaseBuffer(frameBuffer);
            void invoke("acknowledge_direct_video_frame", { captureId: metadata.captureId }).catch(error => {
                console.error("Could not acknowledge a Tauri WGC frame:", error);
            });
        }
    });
    const directVideoErrorReady = listen<{ captureId: string; message: string }>("desktop-video-error", event => {
        for (const callback of [...(directVideoErrorListeners.get(event.payload.captureId) ?? [])]) {
            callback(event.payload.message);
        }
    }).then(() => undefined).catch(error => {
        console.error("Could not subscribe to Tauri WGC errors:", error);
    });

    window.p2pcastDesktop = Object.freeze({
        getWindowSources: async () => (await invoke<DesktopCaptureTarget[]>("list_capture_targets"))
            .filter(target => target.kind === "window")
            .map(target => ({ id: target.id, name: target.name, thumbnailDataUrl: target.thumbnailDataUrl ?? "" })),
        listCaptureTargets: () => invoke<DesktopCaptureTarget[]>("list_capture_targets"),
        resolveCaptureTarget: (selector: string) => invoke<DesktopCaptureTarget | null>("resolve_capture_target", { selector }),
        registerShortcutProfiles: async profiles => {
            await unregisterAll();
            const results: DesktopShortcutRegistrationResult[] = [];
            const seen = new Set<string>();
            for (const profile of profiles) {
                const canonical = profile.shortcut.toLowerCase().split("+").map(part => part.trim()).sort().join("+");
                if (seen.has(canonical)) {
                    results.push({ id: profile.id, ok: false, error: "duplicate" });
                    continue;
                }
                seen.add(canonical);
                const shortcut = profile.shortcut.replace(/^Ctrl\+/i, "CommandOrControl+");
                try {
                    await register(shortcut, event => {
                        if (event.state !== "Pressed") return;
                        for (const callback of [...shortcutCallbacks]) callback(profile.id);
                    });
                    results.push({ id: profile.id, ok: true });
                } catch {
                    results.push({ id: profile.id, ok: false, error: "unavailable" });
                }
            }
            return results;
        },
        onShortcutProfile: (callback: (profileId: string) => void) => {
            shortcutCallbacks.add(callback);
            return () => shortcutCallbacks.delete(callback);
        },
        selectWindow: async (sourceId: string) => {
            if (typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > 256) throw new TypeError("Invalid capture target id");
        },
        getConfig: async () => {
            const config = await invoke<TauriDesktopConfig>("desktop_config");
            return {
                ...config,
                host: "tauri" as const,
                appOrigin: window.location.origin,
            };
        },
        copyShareLink: (link: string) => invoke<void>("copy_share_link", { link }),
        showLiveToast: (toast: DesktopLiveToast) => invoke<void>("show_live_toast", { toast }),
        getReadyUpdate: () => invoke<DesktopUpdate | null>("get_ready_update"),
        installUpdate: () => invoke<void>("install_ready_update"),
        onUpdateReady: (callback: (update: DesktopUpdate) => void) => {
            let active = true;
            let unlisten: (() => void) | undefined;
            void listen<DesktopUpdate>("update-ready", event => callback(event.payload)).then(remove => {
                if (active) unlisten = remove;
                else remove();
            });
            return () => {
                active = false;
                unlisten?.();
            };
        },
        onUpdateNotice: (callback: (notice: DesktopUpdateNotice) => void) => {
            let active = true;
            let unlisten: (() => void) | undefined;
            void listen<DesktopUpdateNotice>("update-notice", event => callback(event.payload)).then(remove => {
                if (active) unlisten = remove;
                else remove();
            });
            return () => {
                active = false;
                unlisten?.();
            };
        },
        // A click on the toast window comes back as "open-live" with the broadcast id.
        onNotificationWatch: (callback: (peerId: string) => void) => {
            let active = true;
            let unlisten: (() => void) | undefined;
            void listen<string>("open-live", event => callback(event.payload)).then(remove => {
                if (active) unlisten = remove;
                else remove();
            });
            return () => {
                active = false;
                unlisten?.();
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
        startApplicationAudio: (sourceId: string) => invoke<{
            captureId: string;
            format: DesktopApplicationAudioFormat;
        }>("start_application_audio", { sourceId }),
        resumeApplicationAudio: async (captureId: string) => {
            await Promise.all(audioListenersReady.get(captureId) ?? []);
            await invoke<void>("resume_application_audio", { captureId });
            audioListenersReady.delete(captureId);
        },
        stopApplicationAudio: async (captureId: string) => {
            audioListenersReady.delete(captureId);
            await invoke<void>("stop_application_audio", { captureId });
        },
        onApplicationAudioData: (captureId: string, callback: (chunk: ArrayBuffer) => void) => {
            let active = true;
            let unlisten: (() => void) | undefined;
            const ready = listen<{ captureId: string; chunk: number[] }>("desktop-audio-data", event => {
                if (!active || event.payload.captureId !== captureId || !Array.isArray(event.payload.chunk)) return;
                callback(Uint8Array.from(event.payload.chunk).buffer);
            }).then(remove => {
                if (active) unlisten = remove;
                else remove();
            });
            audioListenersReady.set(captureId, [...(audioListenersReady.get(captureId) ?? []), ready.then(() => undefined)]);
            return () => {
                active = false;
                unlisten?.();
            };
        },
        onApplicationAudioError: (captureId: string, callback: (message: string) => void) => {
            let active = true;
            let unlisten: (() => void) | undefined;
            const ready = listen<{ captureId: string; message: string }>("desktop-audio-error", event => {
                if (active && event.payload.captureId === captureId) callback(event.payload.message);
            }).then(remove => {
                if (active) unlisten = remove;
                else remove();
            });
            audioListenersReady.set(captureId, [...(audioListenersReady.get(captureId) ?? []), ready.then(() => undefined)]);
            return () => {
                active = false;
                unlisten?.();
            };
        },
        startDirectVideoCapture: (sourceId: string, settings: { fps: number; cursor: "always" | "motion" | "never" }) =>
            invoke<{ captureId: string; width: number; height: number; format: "rgba8" }>("start_direct_video_capture", { sourceId, settings }),
        resumeDirectVideoCapture: async (captureId: string) => {
            await directVideoErrorReady;
            await invoke<void>("resume_direct_video_capture", { captureId });
        },
        acknowledgeDirectVideoFrame: (captureId: string) => invoke<void>("acknowledge_direct_video_frame", { captureId }),
        stopDirectVideoCapture: (captureId: string) => invoke<void>("stop_direct_video_capture", { captureId }),
        onDirectVideoFrame: (captureId: string, callback: (frame: { buffer: ArrayBuffer; width: number; height: number }) => void) => {
            const callbacks = directVideoFrameListeners.get(captureId) ?? new Set();
            callbacks.add(callback);
            directVideoFrameListeners.set(captureId, callbacks);
            return () => {
                callbacks.delete(callback);
                if (callbacks.size === 0) directVideoFrameListeners.delete(captureId);
            };
        },
        startNativeBroadcast: (request: DesktopNativeBroadcastRequest) =>
            invoke<{ peerId: string }>("start_native_broadcast", { request }),
        stopNativeBroadcast: () => invoke<void>("stop_native_broadcast"),
        switchNativeCapture: (request: DesktopNativeCaptureSwitch) => invoke<string | null>("switch_native_capture", { request }),
        sendNativeChat: (message: DesktopChatMessage) => invoke<void>("send_native_chat", { message }),
        setNativeAudioMuted: (muted: boolean) => invoke<void>("set_native_audio_muted", { muted }),
        onNativeBroadcastEvent: (callback: (event: DesktopNativeBroadcastEvent) => void) => {
            let active = true;
            let unlisten: (() => void) | undefined;
            void listen<DesktopNativeBroadcastEvent>("native-broadcast", event => callback(event.payload)).then(remove => {
                if (active) unlisten = remove;
                else remove();
            });
            return () => {
                active = false;
                unlisten?.();
            };
        },
        onDirectVideoError: (captureId: string, callback: (message: string) => void) => {
            const callbacks = directVideoErrorListeners.get(captureId) ?? new Set();
            callbacks.add(callback);
            directVideoErrorListeners.set(captureId, callbacks);
            return () => {
                callbacks.delete(callback);
                if (callbacks.size === 0) directVideoErrorListeners.delete(captureId);
            };
        },
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
