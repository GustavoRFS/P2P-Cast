import { Redirect, useLocalSearchParams } from "expo-router";
import { DesktopHome } from "../features/desktop/DesktopHome";
import { HomeView } from "../features/home/HomeView";
import { parseWatchInput } from "../lib/room";
import { getAppPlatform } from "../platform";

export default function Index() {
    const { watch } = useLocalSearchParams<{ watch?: string }>();

    // Share links are https://live.ligmacharl.es/?watch=<id>; they open the viewer route.
    const peerId = typeof watch === "string" ? parseWatchInput(watch) : null;
    if (peerId) return <Redirect href={{ pathname: "/watch/[peerId]", params: { peerId } }} />;

    // A live that starts takes the app to its room once (AppShell); home stays reachable during it.
    return getAppPlatform() === "desktop" ? <DesktopHome /> : <HomeView />;
}
