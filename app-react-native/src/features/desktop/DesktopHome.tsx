import { useState } from "react";
import { View } from "react-native";
import { Screen } from "../../components/Screen";
import { ErrorCard } from "../../components/Status";
import { useAccount } from "../account/AccountProvider";
import { DiscordDrawer } from "../account/DiscordDrawer";
import { useBroadcast } from "../session/BroadcastProvider";
import { WatchLinkPanel } from "../home/WatchLinkPanel";
import { ShortcutProfiles } from "./ShortcutProfiles";

/** Desktop home: the shortcut manager, the Discord drawer and the watch box. No landing copy. */
export function DesktopHome() {
    const broadcast = useBroadcast();
    const account = useAccount();
    const [drawerOpen, setDrawerOpen] = useState(true);
    const desktop = broadcast.desktop;

    return (
        <View className="flex-1 bg-bg">
            <View className={`flex-1 transition-all duration-300 ease-out ${drawerOpen && account ? "md:pr-[320px]" : ""}`}>
                <Screen>
                    {broadcast.error && <ErrorCard error={broadcast.error} onDismiss={broadcast.clearError} />}
                    <View className="w-full max-w-2xl gap-5 self-center">
                        {desktop && <ShortcutProfiles desktop={desktop} defaults={broadcast.settings} />}
                        <WatchLinkPanel />
                    </View>
                </Screen>
            </View>
            {account && (
                <DiscordDrawer account={account} open={drawerOpen} onToggle={() => setDrawerOpen(current => !current)} />
            )}
        </View>
    );
}
