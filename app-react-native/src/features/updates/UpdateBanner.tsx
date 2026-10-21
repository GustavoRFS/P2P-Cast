import * as Updates from "expo-updates";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useBroadcast } from "../session/BroadcastProvider";
import { UpdatePrompt } from "./UpdatePrompt";

const FOREGROUND_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * EAS Update on Android. expo-updates checks at every launch and applies a downloaded update on the
 * next cold start; this also checks when the app returns to the foreground (it can stay alive for
 * days) and offers to restart into the new bundle right away, except during a broadcast.
 */
export function UpdateBanner() {
    const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
    const { mode } = useBroadcast();
    const [dismissed, setDismissed] = useState<string | null>(null);
    const [restarting, setRestarting] = useState(false);

    useEffect(() => {
        if (!Updates.isEnabled) return;
        let lastCheck = Date.now();
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active" || Date.now() - lastCheck < FOREGROUND_CHECK_INTERVAL_MS) return;
            lastCheck = Date.now();
            void Updates.checkForUpdateAsync()
                .then(result => (result.isAvailable ? Updates.fetchUpdateAsync() : undefined))
                .catch(() => undefined);
        });
        return () => subscription.remove();
    }, []);

    const updateId = downloadedUpdate?.updateId ?? null;
    if (!isUpdatePending || !updateId || dismissed === updateId) return null;
    // Reloading would end the broadcast; it applies on the next launch anyway.
    if (mode === "starting" || mode === "broadcasting") return null;

    return (
        <UpdatePrompt
            title="Atualização pronta"
            message="Reinicie o app para usar a versão nova."
            actionLabel="Reiniciar"
            loading={restarting}
            onAction={() => {
                setRestarting(true);
                void Updates.reloadAsync().catch(() => setRestarting(false));
            }}
            onDismiss={() => setDismissed(updateId)}
        />
    );
}
