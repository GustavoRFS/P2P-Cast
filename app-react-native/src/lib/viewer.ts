export const VIEWER_ID_STORAGE_KEY = "p2pcast.viewer-id";

type ViewerIdStorage = Pick<Storage, "getItem" | "setItem">;

let memoryViewerId: string | null = null;

function getBrowserStorage(): ViewerIdStorage | null {
    if (typeof window === "undefined") return null;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function createViewerId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createViewerSessionId(): string {
    return createViewerId();
}

export function loadViewerId(storage = getBrowserStorage()): string {
    if (storage) {
        try {
            const savedId = storage.getItem(VIEWER_ID_STORAGE_KEY)?.trim();
            if (savedId && savedId.length <= 128) return savedId;

            const newId = createViewerId();
            storage.setItem(VIEWER_ID_STORAGE_KEY, newId);
            return newId;
        } catch {
            // Storage may be disabled in private browsing or restrictive contexts.
        }
    }

    memoryViewerId ??= createViewerId();
    return memoryViewerId;
}
