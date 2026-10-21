import { Platform } from "react-native";

export type AppPlatform = "android" | "desktop" | "web";

/**
 * Native builds are Android. On web the same bundle runs both as the public page and inside the
 * Tauri shell; the desktop bridge (`window.p2pcastDesktop`) is what tells them apart.
 */
export function getAppPlatform(): AppPlatform {
    if (Platform.OS !== "web") return "android";
    return typeof window !== "undefined" && window.p2pcastDesktop ? "desktop" : "web";
}
