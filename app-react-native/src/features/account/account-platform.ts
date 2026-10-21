import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import type { AccountPlatform, SavedSession } from "./types";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://p2p-cast-api.ligmacharl.es";
const CALLBACK_URL = "p2pcast-app://auth/callback";
// Accepted by the backend's presence origin check (backend/src/config.ts).
const PRESENCE_ORIGIN = "p2pcast-app://android";
const SESSION_KEY = "p2pcast.discord-session";
const VERIFIER_KEY = "p2pcast.discord-verifier";
const OAUTH_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

function toBase64Url(base64: string): string {
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function parseAuthCode(url: string | null): string | null {
    if (!url?.startsWith(CALLBACK_URL)) return null;
    const match = /[?&]code=([^&#]+)/.exec(url);
    const code = match ? decodeURIComponent(match[1]) : null;
    return code && OAUTH_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Android account: the session lives in the Keystore-backed secure store, the Discord login runs
 * in a browser auth session that returns to p2pcast-app://auth/callback, and a friend going live
 * becomes a local notification while the app (or its foreground service) is running.
 */
export function createAccountPlatform(): AccountPlatform {
    const listeners = new Set<(code: string) => void>();
    const deliver = (url: string | null) => {
        const code = parseAuthCode(url);
        if (code) listeners.forEach(listener => listener(code));
    };

    // Covers a callback that arrives through the OS instead of the auth session (cold start).
    Linking.addEventListener("url", event => deliver(event.url));
    void Linking.getInitialURL().then(deliver).catch(() => undefined);

    return {
        getBackendUrl: async () => BACKEND_URL,
        loadSession: async () => {
            const raw = await SecureStore.getItemAsync(SESSION_KEY);
            if (!raw) return null;
            try {
                return JSON.parse(raw) as SavedSession;
            } catch {
                return null;
            }
        },
        saveSession: session => SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session)),
        clearSession: () => SecureStore.deleteItemAsync(SESSION_KEY),
        loadVerifier: () => SecureStore.getItemAsync(VERIFIER_KEY),
        saveVerifier: verifier => SecureStore.setItemAsync(VERIFIER_KEY, verifier),
        clearVerifier: () => SecureStore.deleteItemAsync(VERIFIER_KEY),
        createPkcePair: async () => {
            const verifier = toBase64Url(bytesToBase64(Crypto.getRandomBytes(32)));
            const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
                encoding: Crypto.CryptoEncoding.BASE64,
            });
            return { verifier, challenge: toBase64Url(digest) };
        },
        openLogin: async challenge => {
            // Friend notifications only make sense once signed in; a refusal does not block login.
            await Notifications.requestPermissionsAsync().catch(() => undefined);
            const loginUrl = `${BACKEND_URL}/auth/discord?code_challenge=${encodeURIComponent(challenge)}&host=android`;
            const result = await WebBrowser.openAuthSessionAsync(loginUrl, CALLBACK_URL);
            if (result.type === "success") deliver(result.url);
        },
        onAuthCode: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        notifyLive: user => {
            void Notifications.scheduleNotificationAsync({
                content: {
                    title: `${user.username} está ao vivo`,
                    body: user.activity || "Começou uma transmissão",
                    data: { peerId: user.peerId },
                },
                trigger: null,
            }).catch(() => undefined);
        },
        onNotificationWatch: listener => {
            const subscription = Notifications.addNotificationResponseReceivedListener(response => {
                const peerId = response.notification.request.content.data?.peerId;
                if (typeof peerId === "string") listener(peerId);
            });
            return () => subscription.remove();
        },
        createSocket: url => {
            // React Native's WebSocket takes headers as a third argument.
            const NativeWebSocket = WebSocket as unknown as new (
                url: string,
                protocols: string | string[] | undefined,
                options: { headers: Record<string, string> },
            ) => WebSocket;
            return new NativeWebSocket(url, undefined, { headers: { origin: PRESENCE_ORIGIN } });
        },
    };
}
