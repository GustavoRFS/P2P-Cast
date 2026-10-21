import { initializeTauriDesktopBridge } from "../lib/tauri-desktop";

/** Installs `window.p2pcastDesktop` when running inside Tauri; a no-op in a normal browser. */
export function initializeDesktopBridge(): Promise<void> {
    return initializeTauriDesktopBridge();
}
