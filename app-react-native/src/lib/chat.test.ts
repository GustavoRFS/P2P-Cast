import { describe, expect, it, vi } from "vitest";
import {
    buildChatMessage,
    CHAT_SOUND_STORAGE_KEY,
    CHAT_MAX_MESSAGE_LENGTH,
    CHAT_NAME_STORAGE_KEY,
    createMessageId,
    loadChatSoundEnabled,
    loadViewerName,
    loadViewerVolume,
    resolveAuthorName,
    saveChatSoundEnabled,
    sanitizeChatText,
    saveViewerName,
    saveViewerVolume,
    shouldPlayChatNotification,
    VIEWER_VOLUME_STORAGE_KEY,
} from "./chat";

function createMemoryStorage(initialValue?: string) {
    let value = initialValue ?? null;

    return {
        getItem: vi.fn(() => value),
        setItem: vi.fn((_key: string, nextValue: string) => {
            value = nextValue;
        }),
    };
}

describe("resolveAuthorName", () => {
    it("keeps a trimmed custom name", () => {
        expect(resolveAuthorName("  Ana  ", 3)).toBe("Ana");
    });

    it("falls back to a numbered viewer label when blank", () => {
        expect(resolveAuthorName("", 2)).toBe("Espectador 2");
        expect(resolveAuthorName("   ", 2)).toBe("Espectador 2");
        expect(resolveAuthorName(undefined, 5)).toBe("Espectador 5");
    });

    it("truncates names longer than 40 characters", () => {
        const longName = "a".repeat(60);
        expect(resolveAuthorName(longName, 1)).toBe(longName.slice(0, 40));
    });
});

describe("sanitizeChatText", () => {
    it("trims surrounding whitespace", () => {
        expect(sanitizeChatText("  oi galera  ")).toBe("oi galera");
    });

    it("truncates text longer than the max message length", () => {
        const longText = "x".repeat(CHAT_MAX_MESSAGE_LENGTH + 50);
        expect(sanitizeChatText(longText)).toBe(longText.slice(0, CHAT_MAX_MESSAGE_LENGTH));
    });

    it("returns an empty string for blank input", () => {
        expect(sanitizeChatText("   ")).toBe("");
    });
});

describe("viewer name persistence", () => {
    it("loads a trimmed viewer name from storage", () => {
        const storage = createMemoryStorage("  Ana  ");

        expect(loadViewerName(storage)).toBe("Ana");
        expect(storage.getItem).toHaveBeenCalledWith(CHAT_NAME_STORAGE_KEY);
    });

    it("returns an empty string when storage has no viewer name", () => {
        expect(loadViewerName(createMemoryStorage())).toBe("");
    });

    it("saves a trimmed viewer name in storage", () => {
        const storage = createMemoryStorage();

        saveViewerName("  Ana  ", storage);

        expect(storage.setItem).toHaveBeenCalledWith(CHAT_NAME_STORAGE_KEY, "Ana");
    });
});

describe("chat sound preference", () => {
    it("defaults to enabled when no preference is stored", () => {
        expect(loadChatSoundEnabled(createMemoryStorage())).toBe(true);
    });

    it("loads a disabled preference from storage", () => {
        const storage = createMemoryStorage("off");

        expect(loadChatSoundEnabled(storage)).toBe(false);
        expect(storage.getItem).toHaveBeenCalledWith(CHAT_SOUND_STORAGE_KEY);
    });

    it("persists whether chat notification sounds are enabled", () => {
        const storage = createMemoryStorage();

        saveChatSoundEnabled(false, storage);

        expect(storage.setItem).toHaveBeenCalledWith(CHAT_SOUND_STORAGE_KEY, "off");
    });

    it("only notifies when an incoming message arrives while chat is hidden", () => {
        expect(shouldPlayChatNotification(false, true)).toBe(true);
        expect(shouldPlayChatNotification(true, true)).toBe(false);
        expect(shouldPlayChatNotification(false, false)).toBe(false);
    });
});

describe("viewer volume persistence", () => {
    it("defaults to full volume when no preference is stored", () => {
        expect(loadViewerVolume(createMemoryStorage())).toBe(1);
    });

    it("loads a stored volume from storage", () => {
        const storage = createMemoryStorage("0.4");

        expect(loadViewerVolume(storage)).toBe(0.4);
        expect(storage.getItem).toHaveBeenCalledWith(VIEWER_VOLUME_STORAGE_KEY);
    });

    it("clamps an out-of-range or invalid stored volume", () => {
        expect(loadViewerVolume(createMemoryStorage("5"))).toBe(1);
        expect(loadViewerVolume(createMemoryStorage("-2"))).toBe(0);
        expect(loadViewerVolume(createMemoryStorage("not-a-number"))).toBe(1);
    });

    it("persists the volume in storage", () => {
        const storage = createMemoryStorage();

        saveViewerVolume(0.7, storage);

        expect(storage.setItem).toHaveBeenCalledWith(VIEWER_VOLUME_STORAGE_KEY, "0.7");
    });

    it("clamps an out-of-range volume before persisting", () => {
        const storage = createMemoryStorage();

        saveViewerVolume(2, storage);

        expect(storage.setItem).toHaveBeenCalledWith(VIEWER_VOLUME_STORAGE_KEY, "1");
    });
});

describe("createMessageId", () => {
    it("returns a non-empty string", () => {
        expect(typeof createMessageId()).toBe("string");
        expect(createMessageId().length).toBeGreaterThan(0);
    });

    it("returns a different id on each call", () => {
        expect(createMessageId()).not.toBe(createMessageId());
    });
});

describe("buildChatMessage", () => {
    it("builds a message carrying the given text, author and role", () => {
        const message = buildChatMessage({ text: "oi", authorName: "Ana", isBroadcaster: false });

        expect(message.text).toBe("oi");
        expect(message.authorName).toBe("Ana");
        expect(message.isBroadcaster).toBe(false);
        expect(message.id.length).toBeGreaterThan(0);
        expect(message.timestamp).toBeGreaterThan(0);
    });
});
