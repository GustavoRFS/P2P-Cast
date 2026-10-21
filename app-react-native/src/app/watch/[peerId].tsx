import { Redirect, useLocalSearchParams } from "expo-router";
import { ViewerRoom } from "../../features/session/ViewerRoom";
import { parseWatchInput } from "../../lib/room";

export default function WatchScreen() {
    const { peerId } = useLocalSearchParams<{ peerId: string }>();
    const id = typeof peerId === "string" ? parseWatchInput(peerId) : null;

    if (!id) return <Redirect href="/" />;

    // Keyed by id so following another link starts a fresh session.
    return <ViewerRoom key={id} peerId={id} />;
}
