import { Elysia } from "elysia";
import type { BackendConfig } from "./config";
import type { DiscordProfile } from "./auth";

type LiveRecord = {
    user: DiscordProfile;
    peerId: string;
    activity: string | null;
    updatedAt: number;
};

type PresenceSocket = {
    id: string;
    data: { headers: Record<string, string | undefined> };
    send(value: string): unknown;
    close(code?: number, reason?: string): unknown;
};

type ClientMessage =
    | { type: "auth"; token: string }
    | { type: "live"; peerId: string; activity?: string }
    | { type: "offline" };

function parseMessage(value: unknown): ClientMessage | null {
    let parsed = value;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed) as unknown;
        } catch {
            return null;
        }
    }
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) return null;
    const message = parsed as Record<string, unknown>;
    if (message.type === "auth" && typeof message.token === "string" && message.token.length <= 4096) {
        return { type: "auth", token: message.token };
    }
    if (message.type === "live" && typeof message.peerId === "string") {
        return {
            type: "live",
            peerId: message.peerId,
            activity: typeof message.activity === "string" ? message.activity : undefined,
        };
    }
    if (message.type === "offline") return { type: "offline" };
    return null;
}

function validPeerId(peerId: string): boolean {
    return peerId.length >= 1 && peerId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(peerId);
}

function cleanActivity(activity: string | undefined): string | null {
    if (!activity) return null;
    const cleaned = activity.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
    return cleaned || null;
}

export function createPresenceRouter(
    config: BackendConfig,
    verifyAccessToken: (token: string) => Promise<DiscordProfile | null>,
) {
    const sockets = new Map<string, PresenceSocket>();
    const usersBySocket = new Map<string, DiscordProfile>();
    const liveBySocket = new Map<string, LiveRecord>();
    const authenticationTimers = new Map<string, ReturnType<typeof setTimeout>>();

    const currentUsers = () => {
        const unique = new Map<string, LiveRecord>();
        for (const record of liveBySocket.values()) {
            const current = unique.get(record.user.id);
            if (!current || current.updatedAt < record.updatedAt) unique.set(record.user.id, record);
        }

        return [...unique.values()]
            .sort((left, right) => left.user.username.localeCompare(right.user.username))
            .map(({ user, peerId, activity }) => ({
                id: user.id,
                username: user.username,
                avatar: user.avatar,
                peerId,
                activity,
            }));
    };

    const publish = () => {
        const frame = JSON.stringify({ type: "presence", users: currentUsers() });
        for (const id of usersBySocket.keys()) sockets.get(id)?.send(frame);
    };

    const removeSocket = (id: string) => {
        const timer = authenticationTimers.get(id);
        if (timer) clearTimeout(timer);
        authenticationTimers.delete(id);
        sockets.delete(id);
        usersBySocket.delete(id);
        const removedLive = liveBySocket.delete(id);
        if (removedLive) publish();
    };

    const router = new Elysia().ws("/api/presence", {
        open(ws) {
            const socket = ws as unknown as PresenceSocket;
            if (!config.appOrigins.has(socket.data.headers.origin ?? "")) {
                socket.close(4403, "origin not allowed");
                return;
            }

            sockets.set(socket.id, socket);
            authenticationTimers.set(socket.id, setTimeout(() => {
                if (!usersBySocket.has(socket.id)) socket.close(4401, "authentication required");
            }, 5_000));
        },
        async message(ws, value) {
            const socket = ws as unknown as PresenceSocket;
            const message = parseMessage(value);
            if (!message) {
                socket.close(4400, "invalid message");
                return;
            }

            const user = usersBySocket.get(socket.id);
            if (!user) {
                if (message.type !== "auth") {
                    socket.close(4401, "authentication required");
                    return;
                }
                const authenticatedUser = await verifyAccessToken(message.token);
                if (!authenticatedUser) {
                    socket.close(4401, "invalid token");
                    return;
                }
                const timer = authenticationTimers.get(socket.id);
                if (timer) clearTimeout(timer);
                authenticationTimers.delete(socket.id);
                usersBySocket.set(socket.id, authenticatedUser);
                socket.send(JSON.stringify({ type: "authenticated" }));
                socket.send(JSON.stringify({ type: "presence", users: currentUsers() }));
                return;
            }

            if (message.type === "auth") {
                socket.close(4400, "already authenticated");
                return;
            }
            if (message.type === "offline") {
                if (liveBySocket.delete(socket.id)) publish();
                return;
            }
            if (!validPeerId(message.peerId)) {
                socket.close(4400, "invalid peer id");
                return;
            }

            liveBySocket.set(socket.id, {
                user,
                peerId: message.peerId,
                activity: cleanActivity(message.activity),
                updatedAt: Date.now(),
            });
            publish();
        },
        close(ws) {
            removeSocket(ws.id);
        },
    });

    return router;
}
