import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
    AccountPlatform,
    DiscordAccount,
    DiscordProfile,
    LiveUser,
    PresenceUser,
    SavedSession,
} from "./types";

type PresenceFrame = {
    type?: unknown;
    users?: unknown;
};

// Plain string joins instead of `new URL(path, base)`: these run on Hermes too.
function joinUrl(base: string, path: string): string {
    return `${base.replace(/\/+$/, "")}${path}`;
}

function presenceSocketUrl(backendUrl: string): string {
    return joinUrl(backendUrl.replace(/^http/i, "ws"), "/api/presence");
}

function decodeProfile(value: unknown): DiscordProfile | null {
    if (typeof value !== "object" || value === null) return null;
    const user = value as Partial<DiscordProfile>;
    if (typeof user.id !== "string" || typeof user.username !== "string") return null;
    return {
        id: user.id,
        username: user.username,
        avatar: typeof user.avatar === "string" ? user.avatar : null,
    };
}

function decodePresenceUsers(value: unknown): PresenceUser[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        if (typeof item !== "object" || item === null) return [];
        const row = item as Partial<PresenceUser>;
        const user = decodeProfile(row);
        if (!user) return [];
        return [{
            ...user,
            peerId: typeof row.peerId === "string" ? row.peerId : null,
            activity: typeof row.activity === "string" ? row.activity : null,
        }];
    });
}

async function fetchSavedProfile(backendUrl: string, session: SavedSession): Promise<DiscordProfile | null> {
    const response = await fetch(joinUrl(backendUrl, "/api/me"), {
        headers: { authorization: `Bearer ${session.token}` },
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("O backend não conseguiu validar a sessão Discord agora.");
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "user" in body
        ? decodeProfile((body as { user?: unknown }).user)
        : null;
}

/**
 * Discord login (OAuth + PKCE through the backend) and friend presence over WebSocket, shared by
 * every platform that has an account. `platform` is null on the plain web build.
 */
export function useDiscordAccount(platform: AccountPlatform | null): DiscordAccount {
    const [backendUrl, setBackendUrl] = useState<string | null>(null);
    const [session, setSession] = useState<SavedSession | null>(null);
    const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
    const [liveNotifications, setLiveNotifications] = useState<LiveUser[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(Boolean(platform));
    const pendingVerifierRef = useRef<string | null>(null);
    const activeLivePeerRef = useRef<string | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const socketAuthenticatedRef = useRef(false);
    const backendUrlRef = useRef<string | null>(null);

    useEffect(() => {
        if (!platform) return;
        let active = true;

        void (async () => {
            try {
                const url = await platform.getBackendUrl();
                if (!active) return;
                backendUrlRef.current = url;
                setBackendUrl(url);

                const stored = await platform.loadSession();
                if (!active || !stored) return;
                let profile: DiscordProfile | null;
                try {
                    profile = await fetchSavedProfile(url, stored);
                } catch (validationError) {
                    if (!active) return;
                    setSession(stored);
                    setError(validationError instanceof Error
                        ? `${validationError.message} A sessão local foi mantida.`
                        : "Não foi possível validar a sessão Discord agora. A sessão local foi mantida.");
                    return;
                }
                if (!active) return;
                if (!profile) {
                    await platform.clearSession();
                    return;
                }
                const restored = { token: stored.token, user: profile };
                await platform.saveSession(restored);
                setSession(restored);
            } catch (loadError) {
                if (active) setError(loadError instanceof Error ? loadError.message : "Não foi possível abrir a sessão Discord.");
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [platform]);

    useEffect(() => {
        if (!platform || !backendUrl) return;

        const receiveAuthCode = async (code: string) => {
            try {
                let verifier = pendingVerifierRef.current;
                if (!verifier) verifier = await platform.loadVerifier();
                if (!verifier) {
                    setError("O link de login expirou. Inicie o login Discord novamente.");
                    return;
                }
                pendingVerifierRef.current = null;
                await platform.clearVerifier();

                const response = await fetch(joinUrl(backendUrl, "/auth/exchange"), {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ code, verifier }),
                });
                const body: unknown = await response.json();
                if (!response.ok || typeof body !== "object" || body === null || !("token" in body)) {
                    const message = typeof body === "object" && body !== null && "error" in body
                        ? String((body as { error: unknown }).error)
                        : "login_rejected";
                    throw new Error(message === "invalid_or_expired_code"
                        ? "O link de login expirou. Tente novamente."
                        : "O backend recusou este login Discord.");
                }

                const payload = body as { token: unknown; user?: unknown };
                const user = decodeProfile(payload.user);
                if (typeof payload.token !== "string" || !user) throw new Error("Resposta de login inválida.");
                const nextSession = { token: payload.token, user };
                await platform.saveSession(nextSession);
                setSession(nextSession);
                setError(null);
            } catch (loginError) {
                setError(loginError instanceof Error ? loginError.message : "Não foi possível concluir o login Discord.");
            }
        };

        return platform.onAuthCode(code => { void receiveAuthCode(code); });
    }, [backendUrl, platform]);

    useEffect(() => {
        if (!platform || !backendUrl || !session) {
            socketRef.current?.close();
            socketRef.current = null;
            setOnlineUsers([]);
            setLiveNotifications([]);
            return;
        }

        let active = true;
        let attempt = 0;
        let previousLiveUserIds: Set<string> | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let socket: WebSocket | null = null;

        const connect = () => {
            if (!active) return;
            socket = new WebSocket(presenceSocketUrl(backendUrl));
            socketRef.current = socket;

            socket.addEventListener("open", () => {
                attempt = 0;
                socketAuthenticatedRef.current = false;
                socket?.send(JSON.stringify({ type: "auth", token: session.token }));
            });
            socket.addEventListener("message", event => {
                try {
                    const frame = JSON.parse(String(event.data)) as PresenceFrame;
                    if (frame.type === "authenticated") {
                        socketAuthenticatedRef.current = true;
                        if (activeLivePeerRef.current) {
                            socket?.send(JSON.stringify({ type: "live", peerId: activeLivePeerRef.current }));
                        }
                        return;
                    }
                    if (frame.type === "presence") {
                        const users = decodePresenceUsers(frame.users);
                        // Opening the app is not an event; only a started broadcast notifies.
                        const live = users.filter((user): user is LiveUser => user.peerId !== null);
                        if (previousLiveUserIds) {
                            const newlyLive = live.filter(user =>
                                !previousLiveUserIds!.has(user.id) && user.id !== session.user.id,
                            );
                            for (const user of newlyLive) {
                                setLiveNotifications(current => [
                                    ...current.filter(item => item.id !== user.id),
                                    user,
                                ].slice(-3));
                                platform.notifyLive?.(user);
                            }
                        }
                        previousLiveUserIds = new Set(live.map(user => user.id));
                        setOnlineUsers(users);
                    }
                } catch {
                    setError("O backend retornou uma atualização de presença inválida.");
                }
            });
            socket.addEventListener("error", () => {
                setError("Não foi possível conectar à presença dos amigos. A transmissão P2P continua disponível.");
            });
            socket.addEventListener("close", () => {
                socketAuthenticatedRef.current = false;
                if (!active) return;
                const delaySeconds = [1, 2, 4, 8, 16, 30][Math.min(attempt, 5)];
                attempt += 1;
                retryTimer = setTimeout(connect, delaySeconds * 1000);
            });
        };

        connect();
        return () => {
            active = false;
            if (retryTimer) clearTimeout(retryTimer);
            socketAuthenticatedRef.current = false;
            socket?.close();
            if (socketRef.current === socket) socketRef.current = null;
        };
    }, [backendUrl, platform, session]);

    const signIn = useCallback(async () => {
        if (!platform) return;
        try {
            const { verifier, challenge } = await platform.createPkcePair();
            pendingVerifierRef.current = verifier;
            await platform.saveVerifier(verifier);
            await platform.openLogin(challenge);
            setError(null);
        } catch (loginError) {
            pendingVerifierRef.current = null;
            await platform.clearVerifier().catch(() => undefined);
            setError(loginError instanceof Error ? loginError.message : "Não foi possível abrir o login Discord.");
        }
    }, [platform]);

    const signOut = useCallback(async () => {
        const currentBackendUrl = backendUrlRef.current;
        const currentSession = session;
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN && socketAuthenticatedRef.current) socket.send(JSON.stringify({ type: "offline" }));
        socket?.close();
        socketRef.current = null;
        pendingVerifierRef.current = null;
        setOnlineUsers([]);
        setSession(null);
        if (currentBackendUrl && currentSession) {
            void fetch(joinUrl(currentBackendUrl, "/api/logout"), {
                method: "POST",
                headers: { authorization: `Bearer ${currentSession.token}` },
            }).catch(() => undefined);
        }
        await platform?.clearSession();
        await platform?.clearVerifier();
    }, [platform, session]);

    const setLivePeer = useCallback((peerId: string | null) => {
        activeLivePeerRef.current = peerId;
        const socket = socketRef.current;
        if (socket?.readyState !== WebSocket.OPEN || !socketAuthenticatedRef.current) return;
        socket.send(JSON.stringify(peerId ? { type: "live", peerId } : { type: "offline" }));
    }, []);

    const watch = useCallback((peerId: string) => {
        router.push({ pathname: "/watch/[peerId]", params: { peerId } });
    }, []);

    const dismissLiveNotification = useCallback((userId: string, peerId: string) => {
        setLiveNotifications(current => current.filter(user => user.id !== userId || user.peerId !== peerId));
    }, []);

    useEffect(() => {
        if (!platform?.onNotificationWatch) return;
        return platform.onNotificationWatch(watch);
    }, [platform, watch]);

    return {
        user: session?.user ?? null,
        onlineUsers,
        liveNotifications,
        error,
        loading,
        signIn,
        signOut,
        setLivePeer,
        dismissLiveNotification,
        watch,
    };
}
