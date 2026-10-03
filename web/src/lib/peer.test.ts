import { describe, expect, it, vi } from "vitest";

vi.mock("peerjs", () => ({
    default: vi.fn(),
}));

import Peer from "peerjs";
import { createPeer } from "./peer";

describe("PeerJS transport", () => {
    it("uses Google STUN with the PeerJS Cloud defaults", () => {
        createPeer();

        expect(Peer).toHaveBeenCalledWith({
            config: {
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
            },
            debug: 1,
        });
    });

    it("reuses a provided broadcast id", () => {
        createPeer("broadcast-123");

        expect(Peer).toHaveBeenCalledWith("broadcast-123", {
            config: {
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
            },
            debug: 1,
        });
    });
});
