export const BROADCAST_ID_STORAGE_KEY = "p2pcast.broadcast-id";

type BroadcastIdStorage = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): BroadcastIdStorage | null {
    if (typeof window === "undefined") return null;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function loadBroadcastId(storage = getBrowserStorage()): string | null {
    if (!storage) return null;

    try {
        const storedId = storage.getItem(BROADCAST_ID_STORAGE_KEY)?.trim();
        return storedId || null;
    } catch {
        return null;
    }
}

export function saveBroadcastId(id: string, storage = getBrowserStorage()): void {
    if (!storage) return;

    try {
        storage.setItem(BROADCAST_ID_STORAGE_KEY, id);
    } catch {
        // Storage can be unavailable in private browsing or restrictive contexts.
    }
}

export function parseWatchId(search: string): string | null {
    const id = new URLSearchParams(search).get("watch")?.trim();
    return id || null;
}

export function buildWatchUrl(origin: string, pathname: string, peerId: string): string {
    const url = new URL(pathname || "/", origin);
    url.searchParams.set("watch", peerId);
    return url.toString();
}
