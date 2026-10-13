import { describe, expect, it, vi } from "vitest";

vi.mock("peerjs", () => ({
    default: vi.fn(),
}));

import Peer from "peerjs";
import { createPeer } from "./peer";

describe("PeerJS transport", () => {
    it("uses the self-hosted PeerJS server and Google STUN", () => {
        createPeer();

        expect(Peer).toHaveBeenCalledWith({
            host: "129.148.41.116",
            port: 9000,
            path: "/peerjs",
            key: "peerjs",
            secure: false,
            config: {
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
            },
            debug: 1,
        });
    });

    it("reuses a provided broadcast id", () => {
        createPeer("broadcast-123");

        expect(Peer).toHaveBeenCalledWith("broadcast-123", {
            host: "129.148.41.116",
            port: 9000,
            path: "/peerjs",
            key: "peerjs",
            secure: false,
            config: {
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
            },
            debug: 1,
        });
    });
});
