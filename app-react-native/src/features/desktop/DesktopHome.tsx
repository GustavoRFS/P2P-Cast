import { View } from "react-native";
import { Screen } from "../../components/Screen";
import { ErrorCard } from "../../components/Status";
import { useBroadcast } from "../session/BroadcastProvider";
import { WatchLinkPanel } from "../home/WatchLinkPanel";
import { ShortcutProfiles } from "./ShortcutProfiles";

/** Desktop home: the shortcut manager and the watch box (the Discord drawer is the shell's). */
export function DesktopHome() {
    const broadcast = useBroadcast();
    const desktop = broadcast.desktop;
    const live = broadcast.mode === "starting" || broadcast.mode === "broadcasting";

    return (
        <Screen>
            {broadcast.error && <ErrorCard error={broadcast.error} onDismiss={broadcast.clearError} />}
            <View className="w-full max-w-2xl gap-5 self-center">
                {desktop && <ShortcutProfiles desktop={desktop} defaults={broadcast.settings} live={live} onStopLive={broadcast.stop} />}
                <WatchLinkPanel />
            </View>
        </Screen>
    );
}
