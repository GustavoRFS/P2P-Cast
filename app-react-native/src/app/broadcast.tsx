import { Redirect } from "expo-router";
import { BroadcastRoom } from "../features/session/BroadcastRoom";
import { useBroadcast } from "../features/session/BroadcastProvider";

export default function BroadcastScreen() {
    const broadcast = useBroadcast();

    // Stopped or failed: back home, where the error (if any) is shown.
    if (broadcast.mode === "idle" || broadcast.mode === "error") return <Redirect href="/" />;

    return <BroadcastRoom />;
}
