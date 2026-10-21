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

const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function decodeQueryComponent(value: string): string {
    try {
        return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
        return value;
    }
}

// Parsed by hand instead of URLSearchParams: the Hermes runtime on Android does not
// implement all of it, and these helpers run on every platform.
export function parseWatchId(search: string): string | null {
    const query = search.startsWith("?") ? search.slice(1) : search;
    for (const pair of query.split("&")) {
        const [rawKey, ...rawValue] = pair.split("=");
        if (decodeQueryComponent(rawKey) !== "watch") continue;
        const id = decodeQueryComponent(rawValue.join("=")).trim();
        return id || null;
    }
    return null;
}

export function buildWatchUrl(origin: string, pathname: string, peerId: string): string {
    const base = origin.replace(/\/+$/, "");
    const path = !pathname ? "/" : pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${base}${path}?watch=${encodeURIComponent(peerId)}`;
}

/** Accepts a pasted share link (`?watch=` or `/watch/<id>`) or a bare broadcast id. */
export function parseWatchInput(input: string): string | null {
    const value = input.trim();
    if (!value) return null;
    if (PEER_ID_PATTERN.test(value)) return value;

    const queryStart = value.indexOf("?");
    if (queryStart >= 0) {
        const fromQuery = parseWatchId(value.slice(queryStart).split("#")[0]);
        if (fromQuery && PEER_ID_PATTERN.test(fromQuery)) return fromQuery;
    }

    const fromPath = /\/watch\/([A-Za-z0-9_-]{1,128})\/?(?:[?#].*)?$/.exec(value);
    return fromPath ? fromPath[1] : null;
}
