import { describe, expect, it, vi } from "vitest";
import { createChatNotificationPlayer, type ChatNotificationAudioContext } from "./chat-sound";

function createAudioContext() {
    const oscillator = {
        connect: vi.fn(),
        frequency: { setValueAtTime: vi.fn() },
        start: vi.fn(),
        stop: vi.fn(),
        type: "sine" as OscillatorType,
    };
    const gain = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: {
            exponentialRampToValueAtTime: vi.fn(),
            setValueAtTime: vi.fn(),
        },
    };
    const context = {
        close: vi.fn(() => Promise.resolve()),
        createGain: vi.fn(() => gain),
        createOscillator: vi.fn(() => oscillator),
        currentTime: 12,
        destination: {},
        resume: vi.fn(() => Promise.resolve()),
    } as unknown as ChatNotificationAudioContext;

    return { context, gain, oscillator };
}

describe("chat notification sound", () => {
    it("resumes the audio context when the user unlocks notifications", async () => {
        const { context } = createAudioContext();
        const player = createChatNotificationPlayer(() => context);

        await player.unlock();

        expect(context.resume).toHaveBeenCalledTimes(1);
    });

    it("schedules a short notification tone", async () => {
        const { context, gain, oscillator } = createAudioContext();
        const player = createChatNotificationPlayer(() => context);

        await player.play();

        expect(context.createGain).toHaveBeenCalledTimes(1);
        expect(context.createOscillator).toHaveBeenCalledTimes(1);
        expect(oscillator.connect).toHaveBeenCalledWith(gain);
        expect(gain.connect).toHaveBeenCalledWith(context.destination);
        expect(oscillator.start).toHaveBeenCalledWith(12);
        expect(oscillator.stop).toHaveBeenCalledWith(12.16);
    });

    it("closes the audio context when disposed", async () => {
        const { context } = createAudioContext();
        const player = createChatNotificationPlayer(() => context);

        await player.unlock();
        await player.dispose();

        expect(context.close).toHaveBeenCalledTimes(1);
    });
});
