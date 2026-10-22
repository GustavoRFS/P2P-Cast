import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTURE_SETTINGS } from "./capture";
import {
    describeTargetSelector,
    isShortcutProfile,
    isTypingKeyAlone,
    isValidShortcut,
    sameShortcut,
    SYSTEM_AUDIO_SOURCE,
    type ShortcutProfile,
} from "./shortcut-profiles";

describe("shortcuts", () => {
    it("accepts a key alone or a combination", () => {
        expect(isValidShortcut("F9")).toBe(true);
        expect(isValidShortcut("Pause")).toBe(true);
        expect(isValidShortcut("A")).toBe(true);
        expect(isValidShortcut("Ctrl+Shift+F9")).toBe(true);
    });

    it("rejects broken or unknown keys", () => {
        expect(isValidShortcut("")).toBe(false);
        expect(isValidShortcut("Ctrl+")).toBe(false);
        expect(isValidShortcut("Ctrl+Ctrl+A")).toBe(false);
        expect(isValidShortcut("Hyper+A")).toBe(false);
        expect(isValidShortcut("F25")).toBe(false);
        expect(isValidShortcut("Banana")).toBe(false);
    });

    it("flags keys that would stop typing elsewhere", () => {
        expect(isTypingKeyAlone("A")).toBe(true);
        expect(isTypingKeyAlone("Space")).toBe(true);
        expect(isTypingKeyAlone("F9")).toBe(false);
        expect(isTypingKeyAlone("Ctrl+A")).toBe(false);
    });

    it("compares combinations regardless of order and case", () => {
        expect(sameShortcut("ctrl+shift+f9", "Shift+Ctrl+F9")).toBe(true);
        expect(sameShortcut("F9", "Ctrl+F9")).toBe(false);
    });

    it("keeps profiles with a single-key shortcut", () => {
        const profile: ShortcutProfile = {
            id: "p1",
            name: "CS",
            videoTarget: { kind: "monitor", selector: "monitor:\\\\.\\DISPLAY1" },
            captureMethod: "direct",
            audioSourceSelector: SYSTEM_AUDIO_SOURCE,
            shortcut: "F9",
            settings: { ...DEFAULT_CAPTURE_SETTINGS, source: "screen", audio: true },
        };
        expect(isShortcutProfile(profile)).toBe(true);
    });
});

describe("saved targets", () => {
    it("names a window by its title and program", () => {
        expect(describeTargetSelector("window:c:\\games\\cs2\\cs2.exe#counter-strike 2")).toBe("counter-strike 2 · cs2.exe");
    });

    it("names a monitor by its device", () => {
        expect(describeTargetSelector("monitor:\\\\.\\DISPLAY1")).toBe("Tela inteira (DISPLAY1)");
    });
});
