export type PresenceStatus = "online" | "busy" | "invisible";

export const PRESENCE_STATUS_OPTIONS: { value: PresenceStatus; label: string; description: string }[] = [
    { value: "online", label: "Online", description: "Aparece para todos e recebe avisos de live" },
    { value: "busy", label: "Ocupado", description: "Aparece como ocupado e não recebe nenhum aviso" },
    { value: "invisible", label: "Invisível", description: "Ninguém te vê na lista, nem ao vivo" },
];

export type ToastCorner = "top-right" | "bottom-right" | "top-left" | "bottom-left";

export const TOAST_CORNER_OPTIONS: { value: ToastCorner; label: string }[] = [
    { value: "bottom-right", label: "Canto inferior direito" },
    { value: "top-right", label: "Canto superior direito" },
    { value: "bottom-left", label: "Canto inferior esquerdo" },
    { value: "top-left", label: "Canto superior esquerdo" },
];

export const PRESENCE_STATUS_STORAGE_KEY = "p2pcast.presence-status";
export const TOAST_CORNER_STORAGE_KEY = "p2pcast.toast-corner";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): PrefsStorage | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

function load<T extends string>(key: string, allowed: readonly T[], fallback: T, storage: PrefsStorage | null): T {
    if (!storage) return fallback;
    try {
        const value = storage.getItem(key);
        return allowed.includes(value as T) ? value as T : fallback;
    } catch {
        return fallback;
    }
}

function save(key: string, value: string, storage: PrefsStorage | null): void {
    if (!storage) return;
    try {
        storage.setItem(key, value);
    } catch {
        // Storage can be unavailable in private browsing or restrictive contexts.
    }
}

export function loadPresenceStatus(storage = getBrowserStorage()): PresenceStatus {
    return load(PRESENCE_STATUS_STORAGE_KEY, PRESENCE_STATUS_OPTIONS.map(option => option.value), "online", storage);
}

export function savePresenceStatus(status: PresenceStatus, storage = getBrowserStorage()): void {
    save(PRESENCE_STATUS_STORAGE_KEY, status, storage);
}

// Steam's default spot.
export function loadToastCorner(storage = getBrowserStorage()): ToastCorner {
    return load(TOAST_CORNER_STORAGE_KEY, TOAST_CORNER_OPTIONS.map(option => option.value), "bottom-right", storage);
}

export function saveToastCorner(corner: ToastCorner, storage = getBrowserStorage()): void {
    save(TOAST_CORNER_STORAGE_KEY, corner, storage);
}
