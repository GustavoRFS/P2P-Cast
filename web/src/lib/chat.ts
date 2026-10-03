export interface ChatMessage {
    id: string;
    authorName: string;
    text: string;
    timestamp: number;
    isBroadcaster: boolean;
}

export const CHAT_NAME_STORAGE_KEY = "p2pcast.viewer-name";
export const CHAT_SOUND_STORAGE_KEY = "p2pcast.chat-sound";
export const VIEWER_VOLUME_STORAGE_KEY = "p2pcast.viewer-volume";
export const CHAT_MAX_MESSAGE_LENGTH = 500;
export const CHAT_MAX_NAME_LENGTH = 40;
export const CHAT_CONNECTION_ROLE = "chat";

type ChatNameStorage = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): ChatNameStorage | null {
    if (typeof window === "undefined") return null;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function loadViewerName(storage = getBrowserStorage()): string {
    if (!storage) return "";

    try {
        return storage.getItem(CHAT_NAME_STORAGE_KEY)?.trim() ?? "";
    } catch {
        return "";
    }
}

export function saveViewerName(name: string, storage = getBrowserStorage()): void {
    if (!storage) return;

    try {
        storage.setItem(CHAT_NAME_STORAGE_KEY, name.trim());
    } catch {
        // Storage can be unavailable in private browsing or restrictive contexts.
    }
}

export function loadChatSoundEnabled(storage = getBrowserStorage()): boolean {
    if (!storage) return true;

    try {
        return storage.getItem(CHAT_SOUND_STORAGE_KEY) !== "off";
    } catch {
        return true;
    }
}

export function saveChatSoundEnabled(enabled: boolean, storage = getBrowserStorage()): void {
    if (!storage) return;

    try {
        storage.setItem(CHAT_SOUND_STORAGE_KEY, enabled ? "on" : "off");
    } catch {
        // Storage can be unavailable in private browsing or restrictive contexts.
    }
}

export function loadViewerVolume(storage = getBrowserStorage()): number {
    if (!storage) return 1;

    try {
        const raw = storage.getItem(VIEWER_VOLUME_STORAGE_KEY);
        if (raw === null) return 1;

        const parsed = Number(raw);
        if (Number.isNaN(parsed)) return 1;

        return Math.min(1, Math.max(0, parsed));
    } catch {
        return 1;
    }
}

export function saveViewerVolume(volume: number, storage = getBrowserStorage()): void {
    if (!storage) return;

    try {
        storage.setItem(VIEWER_VOLUME_STORAGE_KEY, String(Math.min(1, Math.max(0, volume))));
    } catch {
        // Storage can be unavailable in private browsing or restrictive contexts.
    }
}

export function shouldPlayChatNotification(chatOpen: boolean, soundEnabled: boolean): boolean {
    return !chatOpen && soundEnabled;
}

export function resolveAuthorName(rawName: string | undefined, viewerIndex: number): string {
    const trimmed = rawName?.trim();
    return trimmed ? trimmed.slice(0, CHAT_MAX_NAME_LENGTH) : `Espectador ${viewerIndex}`;
}

export function sanitizeChatText(rawText: string): string {
    return rawText.trim().slice(0, CHAT_MAX_MESSAGE_LENGTH);
}

export function createMessageId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildChatMessage(params: {
    text: string;
    authorName: string;
    isBroadcaster: boolean;
}): ChatMessage {
    return {
        id: createMessageId(),
        authorName: params.authorName,
        text: params.text,
        timestamp: Date.now(),
        isBroadcaster: params.isBroadcaster,
    };
}

export function formatMessageTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
