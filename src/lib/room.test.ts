import { describe, expect, it, vi } from "vitest";
import {
    BROADCAST_ID_STORAGE_KEY,
    buildWatchUrl,
    loadBroadcastId,
    parseWatchId,
    saveBroadcastId,
} from "./room";

function createMemoryStorage(initialValue?: string) {
    let value = initialValue ?? null;

    return {
        getItem: vi.fn(() => value),
        setItem: vi.fn((_key: string, nextValue: string) => {
            value = nextValue;
        }),
    };
}

describe("room links", () => {
    it("builds a viewer link with the PeerJS id", () => {
        expect(buildWatchUrl("https://p2p.example", "/", "abc-123")).toBe(
            "https://p2p.example/?watch=abc-123",
        );
    });

    it("reads a trimmed watch id from a query string", () => {
        expect(parseWatchId("?watch=%20abc-123%20")).toBe("abc-123");
    });

    it("returns null when no watch id exists", () => {
        expect(parseWatchId("")).toBeNull();
    });
});

describe("broadcast id persistence", () => {
    it("loads a trimmed broadcast id from storage", () => {
        const storage = createMemoryStorage("  broadcast-123  ");

        expect(loadBroadcastId(storage)).toBe("broadcast-123");
        expect(storage.getItem).toHaveBeenCalledWith(BROADCAST_ID_STORAGE_KEY);
    });

    it("returns null when storage has no broadcast id", () => {
        expect(loadBroadcastId(createMemoryStorage())).toBeNull();
    });

    it("saves the broadcast id in storage", () => {
        const storage = createMemoryStorage();

        saveBroadcastId("broadcast-123", storage);

        expect(storage.setItem).toHaveBeenCalledWith(
            BROADCAST_ID_STORAGE_KEY,
            "broadcast-123",
        );
    });
});
