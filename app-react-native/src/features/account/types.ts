export type DiscordProfile = {
    id: string;
    username: string;
    avatar: string | null;
};

/** Someone with the app open; peerId is set only while they are broadcasting. */
export type PresenceUser = DiscordProfile & {
    peerId: string | null;
    activity: string | null;
};

export type LiveUser = PresenceUser & { peerId: string };

export type SavedSession = {
    token: string;
    user: DiscordProfile;
};

/**
 * What the shared account logic needs from the host: where the backend lives, durable session
 * storage, the browser round trip for the Discord OAuth/PKCE login, and an optional way to tell
 * the user that a friend went live. Desktop implements it over the Tauri bridge, Android over
 * Expo modules; the plain web build has no account.
 */
export interface AccountPlatform {
    getBackendUrl(): Promise<string>;
    loadSession(): Promise<SavedSession | null>;
    saveSession(session: SavedSession): Promise<void>;
    clearSession(): Promise<void>;
    loadVerifier(): Promise<string | null>;
    saveVerifier(verifier: string): Promise<void>;
    clearVerifier(): Promise<void>;
    createPkcePair(): Promise<{ verifier: string; challenge: string }>;
    openLogin(codeChallenge: string): Promise<void>;
    onAuthCode(listener: (code: string) => void): () => void;
    notifyLive?(user: LiveUser): void;
    onNotificationWatch?(listener: (peerId: string) => void): () => void;
    /** Opens the presence socket; Android needs to send an Origin the backend accepts. */
    createSocket?(url: string): WebSocket;
}

export type DiscordAccount = {
    user: DiscordProfile | null;
    onlineUsers: PresenceUser[];
    liveNotifications: LiveUser[];
    error: string | null;
    loading: boolean;
    signIn(): Promise<void>;
    signOut(): Promise<void>;
    setLivePeer(peerId: string | null): void;
    dismissLiveNotification(userId: string, peerId: string): void;
    watch(peerId: string): void;
};
