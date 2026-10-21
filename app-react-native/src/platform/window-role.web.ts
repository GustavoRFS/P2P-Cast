/** The Tauri shell opens a second, borderless window on ?window=toast for the live notifications. */
export function isToastWindow(): boolean {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("window") === "toast";
}
