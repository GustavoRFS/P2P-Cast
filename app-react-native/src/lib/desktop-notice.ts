import { loadToastCorner } from "./presence-prefs";

// What the toast window's Rust side accepts.
const MAX_TITLE_BYTES = 100;
const MAX_MESSAGE_BYTES = 200;

function clip(text: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    if (encoder.encode(text).length <= maxBytes) return text;
    let clipped = text;
    while (clipped.length > 0 && encoder.encode(`${clipped}…`).length > maxBytes) clipped = clipped.slice(0, -1);
    return `${clipped.trimEnd()}…`;
}

/**
 * A notice for this computer only, in the toast window and the corner chosen for live
 * notifications: what a shortcut did while the app sat in the tray, or an app message. Other people
 * hear only about lives starting, through the presence server.
 */
export function showDesktopNotice(title: string, message: string): void {
    const desktop = typeof window !== "undefined" ? window.p2pcastDesktop : undefined;
    if (!desktop?.showLiveToast) return;
    void desktop.showLiveToast({
        id: Date.now(),
        userId: "p2p-cast",
        username: clip(title, MAX_TITLE_BYTES),
        avatar: null,
        peerId: "notice",
        corner: loadToastCorner(),
        message: clip(message, MAX_MESSAGE_BYTES),
    }).catch(error => console.error("Could not show a desktop notice:", error));
}
