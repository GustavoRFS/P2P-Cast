import { describe, expect, it } from "vitest";
import { toggleVideoAudio } from "./video";

describe("remote video audio", () => {
    it("activates audio when the video is currently muted", () => {
        const video = { muted: true };

        const audioOn = toggleVideoAudio(video, false);

        expect(audioOn).toBe(true);
        expect(video.muted).toBe(false);
    });

    it("mutes audio when the video is currently active", () => {
        const video = { muted: false };

        const audioOn = toggleVideoAudio(video, true);

        expect(audioOn).toBe(false);
        expect(video.muted).toBe(true);
    });
});
