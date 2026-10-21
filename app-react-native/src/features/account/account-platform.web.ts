import type { AccountPlatform } from "./types";

function encodeBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Desktop account over the Tauri bridge: keyring-backed session storage and the
 * p2pcast-tauri:// deep link that returns the OAuth code. The public web page has no account.
 */
export function createAccountPlatform(): AccountPlatform | null {
    const desktop = typeof window !== "undefined" ? window.p2pcastDesktop : undefined;
    if (!desktop) return null;

    return {
        getBackendUrl: async () => (await desktop.getConfig()).backendUrl,
        loadSession: () => desktop.getSavedSession(),
        saveSession: session => desktop.saveSession(session),
        clearSession: () => desktop.clearSession(),
        loadVerifier: () => desktop.getLoginVerifier(),
        saveVerifier: verifier => desktop.saveLoginVerifier(verifier),
        clearVerifier: () => desktop.clearLoginVerifier(),
        createPkcePair: async () => {
            const verifier = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
            return { verifier, challenge: encodeBase64Url(new Uint8Array(digest)) };
        },
        openLogin: challenge => desktop.loginWithDiscord(challenge),
        onAuthCode: listener => desktop.onAuthCallback(listener),
        onNotificationWatch: desktop.onNotificationWatch
            ? listener => desktop.onNotificationWatch!(listener)
            : undefined,
    };
}
