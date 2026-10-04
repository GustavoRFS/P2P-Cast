import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopConfig, isDesktopApp, type DesktopConfig } from "./desktop";

export type DiscordProfile = {
    id: string;
    username: string;
    avatar: string | null;
};

export type DesktopLiveUser = DiscordProfile & {
    peerId: string;
    activity: string | null;
};

type SavedSession = {
    token: string;
    user: DiscordProfile;
};

type PresenceFrame = {
    type?: unknown;
    users?: unknown;
};

export type DesktopAccount = {
    user: DiscordProfile | null;
    liveUsers: DesktopLiveUser[];
    error: string | null;
    loading: boolean;
    signIn(): Promise<void>;
    signOut(): Promise<void>;
    setLivePeer(peerId: string | null): void;
    watch(peerId: string): void;
};

function encodeBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

function decodeLiveUsers(value: unknown): DesktopLiveUser[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        if (typeof item !== "object" || item === null) return [];
        const row = item as Partial<DesktopLiveUser>;
        const user = decodeProfile(row);
        if (!user || typeof row.peerId !== "string") return [];
        return [{
            ...user,
            peerId: row.peerId,
            activity: typeof row.activity === "string" ? row.activity : null,
        }];
    });
}

async function fetchSavedProfile(config: DesktopConfig, session: SavedSession): Promise<DiscordProfile | null> {
    const response = await fetch(new URL("/api/me", config.backendUrl), {
        headers: { authorization: `Bearer ${session.token}` },
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("O backend não conseguiu validar a sessão Discord agora.");
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "user" in body
        ? decodeProfile((body as { user?: unknown }).user)
        : null;
}

export function useDesktopAccount(): DesktopAccount {
    const desktop = window.p2pcastDesktop;
    const desktopMode = isDesktopApp();
    const [config, setConfig] = useState<DesktopConfig | null>(null);
    const [session, setSession] = useState<SavedSession | null>(null);
    const [liveUsers, setLiveUsers] = useState<DesktopLiveUser[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(desktopMode);
    const pendingVerifierRef = useRef<string | null>(null);
    const activeLivePeerRef = useRef<string | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const socketAuthenticatedRef = useRef(false);
    const configRef = useRef<DesktopConfig | null>(null);

    useEffect(() => {
        configRef.current = config;
    }, [config]);

    useEffect(() => {
        if (!desktop) return;
        let active = true;

        void (async () => {
            try {
                const desktopConfig = await getDesktopConfig();
                if (!active || !desktopConfig) return;
                configRef.current = desktopConfig;
                setConfig(desktopConfig);

                const stored = await desktop.getSavedSession();
                if (!active || !stored) return;
                let profile: DiscordProfile | null;
                try {
                    profile = await fetchSavedProfile(desktopConfig, stored);
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
                    await desktop.clearSession();
                    return;
                }
                const restored = { token: stored.token, user: profile };
                await desktop.saveSession(restored);
                setSession(restored);
            } catch (loadError) {
                if (active) setError(loadError instanceof Error ? loadError.message : "Não foi possível abrir a sessão Discord.");
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [desktop]);

    useEffect(() => {
        if (!desktop || !config) return;
        const receiveAuthCode = async (code: string) => {
            try {
                let verifier = pendingVerifierRef.current;
                if (!verifier) verifier = await desktop.getLoginVerifier();
                if (!verifier) {
                    setError("O link de login expirou. Inicie o login Discord novamente.");
                    return;
                }
                pendingVerifierRef.current = null;
                await desktop.clearLoginVerifier();

                const response = await fetch(new URL("/auth/exchange", config.backendUrl), {
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
                await desktop.saveSession(nextSession);
                setSession(nextSession);
                setError(null);
            } catch (loginError) {
                setError(loginError instanceof Error ? loginError.message : "Não foi possível concluir o login Discord.");
            }
        };

        return desktop.onAuthCallback(code => { void receiveAuthCode(code); });
    }, [config, desktop]);

    useEffect(() => {
        if (!desktop || !config || !session) {
            socketRef.current?.close();
            socketRef.current = null;
            setLiveUsers([]);
            return;
        }

        let active = true;
        let attempt = 0;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let socket: WebSocket | null = null;

        const connect = () => {
            if (!active) return;
            const url = new URL("/api/presence", config.backendUrl);
            url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
            socket = new WebSocket(url);
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
                    if (frame.type === "presence") setLiveUsers(decodeLiveUsers(frame.users));
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
    }, [config, desktop, session]);

    const signIn = useCallback(async () => {
        if (!desktop) return;
        try {
            const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
            const verifier = encodeBase64Url(verifierBytes);
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
            const challenge = encodeBase64Url(new Uint8Array(digest));
            pendingVerifierRef.current = verifier;
            await desktop.saveLoginVerifier(verifier);
            await desktop.loginWithDiscord(challenge);
            setError(null);
        } catch (loginError) {
            pendingVerifierRef.current = null;
            await desktop.clearLoginVerifier().catch(() => undefined);
            setError(loginError instanceof Error ? loginError.message : "Não foi possível abrir o login Discord.");
        }
    }, [desktop]);

    const signOut = useCallback(async () => {
        const currentConfig = configRef.current;
        const currentSession = session;
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN && socketAuthenticatedRef.current) socket.send(JSON.stringify({ type: "offline" }));
        socket?.close();
        socketRef.current = null;
        pendingVerifierRef.current = null;
        setLiveUsers([]);
        setSession(null);
        if (currentConfig && currentSession) {
            void fetch(new URL("/api/logout", currentConfig.backendUrl), {
                method: "POST",
                headers: { authorization: `Bearer ${currentSession.token}` },
            }).catch(() => undefined);
        }
        await desktop?.clearSession();
        await desktop?.clearLoginVerifier();
    }, [desktop, session]);

    const setLivePeer = useCallback((peerId: string | null) => {
        activeLivePeerRef.current = peerId;
        const socket = socketRef.current;
        if (socket?.readyState !== WebSocket.OPEN || !socketAuthenticatedRef.current) return;
        socket.send(JSON.stringify(peerId ? { type: "live", peerId } : { type: "offline" }));
    }, []);

    const watch = useCallback((peerId: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set("watch", peerId);
        window.location.assign(url.toString());
    }, []);

    return {
        user: session?.user ?? null,
        liveUsers,
        error,
        loading,
        signIn,
        signOut,
        setLivePeer,
        watch,
    };
}
