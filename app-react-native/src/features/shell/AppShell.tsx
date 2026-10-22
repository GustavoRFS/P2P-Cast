import { router, usePathname } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { getAppPlatform } from "../../platform";
import type { StreamMode } from "../../lib/types";
import { useAccount } from "../account/AccountProvider";
import { DiscordDrawer } from "../account/DiscordDrawer";
import { useBroadcast } from "../session/BroadcastProvider";

const BROADCAST_ROUTE = "/broadcast";

function isLive(mode: StreamMode): boolean {
    return mode === "starting" || mode === "broadcasting";
}

/** Opens the live room once, when a live starts (a shortcut can start one on any screen). */
export function goToBroadcast() {
    router.push(BROADCAST_ROUTE);
}

/**
 * Every screen sits in this shell: the Discord drawer stays put while navigating (open by default on
 * desktop, where the page makes room for it), and a live that starts takes the app to its room once.
 * From there the user is free to go home or watch others and come back with "Ver transmissão".
 */
export function AppShell({ children }: { children: ReactNode }) {
    const account = useAccount();
    const { mode } = useBroadcast();
    const pathname = usePathname();
    const desktop = getAppPlatform() === "desktop";
    const [drawerOpen, setDrawerOpen] = useState(desktop);
    const previousMode = useRef(mode);

    useEffect(() => {
        const wasLive = isLive(previousMode.current);
        previousMode.current = mode;
        if (isLive(mode) && !wasLive && pathname !== BROADCAST_ROUTE) goToBroadcast();
    }, [mode, pathname]);

    const live = isLive(mode);

    return (
        <View className="flex-1 bg-bg">
            <View className={`flex-1 transition-all duration-300 ease-out ${desktop && drawerOpen && account ? "md:pr-[320px]" : ""}`}>
                {children}
            </View>
            {account && (
                <DiscordDrawer
                    account={account}
                    open={drawerOpen}
                    onToggle={() => setDrawerOpen(current => !current)}
                    onViewLive={live && pathname !== BROADCAST_ROUTE ? goToBroadcast : undefined}
                />
            )}
        </View>
    );
}
