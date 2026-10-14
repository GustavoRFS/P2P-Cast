import Peer from "peerjs";
import type { Peer as PeerInstance } from "peerjs";

const peerOptions = {
    host: "peerjs.ligmacharl.es",
    port: 443,
    path: "/peerjs",
    key: "peerjs",
    secure: true,
    config: {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    },
    debug: 1,
};

export function createPeer(id?: string): Peer {
    return id ? new Peer(id, peerOptions) : new Peer(peerOptions);
}

/** Notify the other PeerJS client that this peer is closing its connections. */
export function sendPeerLeave(peer: PeerInstance, remotePeerId: string): void {
    try {
        const socket = (peer as unknown as {
            socket?: { send(message: { type: "LEAVE"; dst: string }): void };
        }).socket;
        socket?.send({ type: "LEAVE", dst: remotePeerId });
    } catch {
        // The call is still closed locally if the PeerJS socket is unavailable.
    }
}
