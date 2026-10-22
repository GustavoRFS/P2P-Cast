import "../global.css";
import "../platform/storage";
import "../platform/capabilities";

import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AccountProvider } from "../features/account/AccountProvider";
import { InstallAppModal } from "../features/install/InstallAppModal";
import { LiveToasts } from "../features/account/LiveToasts";
import { BroadcastProvider } from "../features/session/BroadcastProvider";
import { AppShell } from "../features/shell/AppShell";
import { LiveToastWindow } from "../features/toast/LiveToastWindow";
import { UpdateBanner } from "../features/updates/UpdateBanner";
import { initializeDesktopBridge } from "../platform/desktop-bridge";
import { isToastWindow } from "../platform/window-role";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const theme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: "#07111f",
        card: "#07111f",
        primary: "#75e5e0",
        text: "#edf5ff",
        border: "rgba(173, 211, 255, 0.14)",
    },
};

export default function RootLayout() {
    // The desktop notification window shows only the card: no providers, shortcuts or presence socket.
    return isToastWindow() ? <LiveToastWindow /> : <AppLayout />;
}

function AppLayout() {
    // Inside Tauri the bridge must exist before the providers read it (it was main.tsx's job).
    const [bridgeReady, setBridgeReady] = useState(false);

    useEffect(() => {
        let active = true;
        void initializeDesktopBridge()
            .catch(error => console.error("Could not initialize the desktop bridge:", error))
            .finally(() => {
                if (!active) return;
                setBridgeReady(true);
                void SplashScreen.hideAsync().catch(() => undefined);
            });
        return () => { active = false; };
    }, []);

    if (!bridgeReady) return null;

    return (
        <ThemeProvider value={theme}>
            <AccountProvider>
                <BroadcastProvider>
                    <StatusBar style="light" />
                    <AppShell>
                        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#07111f" } }} />
                    </AppShell>
                    <LiveToasts />
                    <UpdateBanner />
                    <InstallAppModal />
                </BroadcastProvider>
            </AccountProvider>
        </ThemeProvider>
    );
}
