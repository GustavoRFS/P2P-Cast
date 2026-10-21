import type { CaptureSettings } from "./capture";
import {
    BITRATE_OPTIONS,
    CURSOR_OPTIONS,
    FPS_OPTIONS,
    RESOLUTION_OPTIONS,
} from "./capture";

export type ShortcutCaptureMethod = "windows-picker" | "direct";
export type ShortcutTargetKind = "window" | "monitor";

export type ShortcutProfile = {
    id: string;
    name: string;
    videoTarget: {
        kind: ShortcutTargetKind;
        selector: string;
    };
    captureMethod: ShortcutCaptureMethod;
    audioSourceSelector: string;
    shortcut: string;
    settings: CaptureSettings & { audio: true };
};

export const SHORTCUT_PROFILES_STORAGE_KEY = "p2pcast.shortcut-profiles.v1";

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Super"] as const;
const COMMON_KEYS = new Set([
    "Space", "Tab", "Enter", "Escape", "Backspace", "Delete", "Insert", "Home", "End",
    "PageUp", "PageDown", "Up", "Down", "Left", "Right", "PrintScreen", "Pause",
]);

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): StorageLike | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function validShortcut(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 80) return false;
    const parts = value.split("+").map(part => part.trim());
    if (parts.length < 2 || parts.some(part => !part)) return false;

    const modifiers = parts.slice(0, -1);
    const key = parts.at(-1)!;
    if (!modifiers.every(modifier => MODIFIERS.some(allowed => allowed.toLowerCase() === modifier.toLowerCase()))) return false;
    if (new Set(modifiers.map(modifier => modifier.toLowerCase())).size !== modifiers.length) return false;
    return /^[A-Z0-9]$/i.test(key) || /^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key) || COMMON_KEYS.has(key);
}

function validSettings(value: unknown): value is ShortcutProfile["settings"] {
    if (!value || typeof value !== "object") return false;
    const settings = value as Partial<CaptureSettings>;
    return settings.source === "screen"
        && settings.audio === true
        && RESOLUTION_OPTIONS.some(option => option.value === settings.resolution)
        && FPS_OPTIONS.some(fps => fps === settings.fps)
        && BITRATE_OPTIONS.some(option => option.value === settings.bitrate)
        && CURSOR_OPTIONS.some(option => option.value === settings.cursor)
        && typeof settings.microphone === "boolean"
        && (settings.cameraFacing === "user" || settings.cameraFacing === "environment");
}

export function isShortcutProfile(value: unknown): value is ShortcutProfile {
    if (!value || typeof value !== "object") return false;
    const profile = value as Partial<ShortcutProfile>;
    return typeof profile.id === "string"
        && profile.id.length > 0
        && profile.id.length <= 80
        && typeof profile.name === "string"
        && profile.name.trim().length > 0
        && profile.name.length <= 80
        && !!profile.videoTarget
        && (profile.videoTarget.kind === "window" || profile.videoTarget.kind === "monitor")
        && typeof profile.videoTarget.selector === "string"
        && profile.videoTarget.selector.length > 0
        && profile.videoTarget.selector.length <= 2048
        && (profile.captureMethod === "windows-picker" || profile.captureMethod === "direct")
        && typeof profile.audioSourceSelector === "string"
        && profile.audioSourceSelector.length > 0
        && profile.audioSourceSelector.length <= 2048
        && validShortcut(profile.shortcut)
        && validSettings(profile.settings);
}

export function canonicalizeShortcut(shortcut: string): string {
    const parts = shortcut.split("+").map(part => part.trim());
    const key = parts.pop() ?? "";
    const modifiers = parts
        .map(part => MODIFIERS.find(modifier => modifier.toLowerCase() === part.toLowerCase()) ?? part)
        .sort((left, right) => MODIFIERS.indexOf(left as (typeof MODIFIERS)[number]) - MODIFIERS.indexOf(right as (typeof MODIFIERS)[number]));
    return [...modifiers, /^[a-z]$/i.test(key) ? key.toUpperCase() : key].join("+");
}

export function findDuplicateShortcutIds(profiles: ShortcutProfile[]): Set<string> {
    const owners = new Map<string, string[]>();
    for (const profile of profiles) {
        const shortcut = canonicalizeShortcut(profile.shortcut).toLowerCase();
        owners.set(shortcut, [...(owners.get(shortcut) ?? []), profile.id]);
    }
    return new Set([...owners.values()].filter(ids => ids.length > 1).flat());
}

export function loadShortcutProfiles(storage = getBrowserStorage()): ShortcutProfile[] {
    if (!storage) return [];
    try {
        const raw = storage.getItem(SHORTCUT_PROFILES_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) return [];
        const profiles = (parsed as { profiles?: unknown }).profiles;
        return Array.isArray(profiles) ? profiles.filter(isShortcutProfile) : [];
    } catch {
        return [];
    }
}

export function saveShortcutProfiles(profiles: ShortcutProfile[], storage = getBrowserStorage()): boolean {
    if (!storage || !profiles.every(isShortcutProfile)) return false;
    try {
        storage.setItem(SHORTCUT_PROFILES_STORAGE_KEY, JSON.stringify({ version: 1, profiles }));
        return true;
    } catch {
        return false;
    }
}
