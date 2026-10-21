import { Redirect, useLocalSearchParams } from "expo-router";
import { DesktopHome } from "../features/desktop/DesktopHome";
import { HomeView } from "../features/home/HomeView";
import { useBroadcast } from "../features/session/BroadcastProvider";
import { parseWatchInput } from "../lib/room";
import { getAppPlatform } from "../platform";

export default function Index() {
    const { watch } = useLocalSearchParams<{ watch?: string }>();
    const broadcast = useBroadcast();

    // Share links are https://live.ligmacharl.es/?watch=<id>; they open the viewer route.
    const peerId = typeof watch === "string" ? parseWatchInput(watch) : null;
    if (peerId) return <Redirect href={{ pathname: "/watch/[peerId]", params: { peerId } }} />;

    // A broadcast can start from here or, on desktop, from a global shortcut on any screen.
    if (broadcast.mode === "starting" || broadcast.mode === "broadcasting") return <Redirect href="/broadcast" />;

    return getAppPlatform() === "desktop" ? <DesktopHome /> : <HomeView />;
}
