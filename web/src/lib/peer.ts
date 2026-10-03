import Peer from "peerjs";

const peerOptions = {
    config: {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    },
    debug: 1,
};

export function createPeer(id?: string): Peer {
    return id ? new Peer(id, peerOptions) : new Peer(peerOptions);
}
