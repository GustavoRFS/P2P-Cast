import { useEffect } from "react";
import { showDesktopNotice } from "../../lib/desktop-notice";

/**
 * Desktop (Tauri) updates are silent: Rust checks the signed feed at startup and every ten
 * minutes, and installs with no window whenever nobody is broadcasting or watching. This page only
 * relays what Rust has to say (failures, and the answers to the tray's "Verificar atualizações") to
 * the toast window, in the corner chosen for live notifications. The public web page has no bridge
 * and shows nothing.
 */
export function UpdateBanner() {
    useEffect(() => {
        const desktop = typeof window !== "undefined" ? window.p2pcastDesktop : undefined;
        return desktop?.onUpdateNotice?.(notice => showDesktopNotice(notice.title, notice.message));
    }, []);

    return null;
}
