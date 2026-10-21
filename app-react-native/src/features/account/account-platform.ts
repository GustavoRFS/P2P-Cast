import type { AccountPlatform } from "./types";

// Replaced by the Android adapter (secure storage, browser login, local notifications).
export function createAccountPlatform(): AccountPlatform | null {
    return null;
}
