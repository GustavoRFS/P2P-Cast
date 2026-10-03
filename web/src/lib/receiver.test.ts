import { afterEach, describe, expect, it, vi } from "vitest";
import { createNegotiationStream } from "./receiver";

class FakeTrack {
    stopped = false;

    constructor(public kind: "audio" | "video") {}

    stop() {
        this.stopped = true;
    }
}

class FakeStream {
    constructor(public tracks: FakeTrack[] = []) {}

    getTracks() {
        return this.tracks;
    }

    getVideoTracks() {
        return this.tracks.filter(track => track.kind === "video");
    }

    getAudioTracks() {
        return this.tracks.filter(track => track.kind === "audio");
    }
}

class FakeAudioContext {
    readonly oscillator = {
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
    };

    readonly gain = {
        gain: { value: 1 },
        connect: vi.fn(),
    };

    readonly destination = {
        stream: new FakeStream([new FakeTrack("audio")]),
    };

    createOscillator() {
        return this.oscillator;
    }

    createGain() {
        return this.gain;
    }

    createMediaStreamDestination() {
        return this.destination;
    }

    close() {
        return Promise.resolve();
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("viewer negotiation stream", () => {
    it("creates silent audio and synthetic video tracks without device access", () => {
        const canvasStream = new FakeStream([new FakeTrack("video")]);
        const canvas = {
            captureStream: vi.fn(() => canvasStream),
        };

        vi.stubGlobal("document", {
            createElement: vi.fn(() => canvas),
        });
        vi.stubGlobal("MediaStream", FakeStream);
        vi.stubGlobal("AudioContext", FakeAudioContext);

        const negotiation = createNegotiationStream();

        expect(negotiation.stream.getVideoTracks()).toHaveLength(1);
        expect(negotiation.stream.getAudioTracks()).toHaveLength(1);
        expect(canvas.captureStream).toHaveBeenCalledWith(1);

        const tracks = negotiation.stream.getTracks() as unknown as FakeTrack[];
        negotiation.dispose();

        expect(tracks.every(track => track.stopped)).toBe(true);
    });
});
