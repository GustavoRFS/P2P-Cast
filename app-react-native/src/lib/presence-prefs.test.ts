import { describe, expect, it } from "vitest";
import {
    loadPresenceStatus,
    loadToastCorner,
    PRESENCE_STATUS_STORAGE_KEY,
    savePresenceStatus,
    saveToastCorner,
    TOAST_CORNER_STORAGE_KEY,
} from "./presence-prefs";

function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
    };
}

describe("presence preferences", () => {
    it("defaults to online and to the bottom-right corner", () => {
        const storage = memoryStorage();
        expect(loadPresenceStatus(storage)).toBe("online");
        expect(loadToastCorner(storage)).toBe("bottom-right");
    });

    it("round-trips the saved values", () => {
        const storage = memoryStorage();
        savePresenceStatus("busy", storage);
        saveToastCorner("top-left", storage);
        expect(loadPresenceStatus(storage)).toBe("busy");
        expect(loadToastCorner(storage)).toBe("top-left");
    });

    it("ignores values it does not know", () => {
        const storage = memoryStorage({ [PRESENCE_STATUS_STORAGE_KEY]: "away", [TOAST_CORNER_STORAGE_KEY]: "middle" });
        expect(loadPresenceStatus(storage)).toBe("online");
        expect(loadToastCorner(storage)).toBe("bottom-right");
    });

    it("falls back when storage is unavailable", () => {
        expect(loadPresenceStatus(null)).toBe("online");
        expect(loadToastCorner(null)).toBe("bottom-right");
    });
});
