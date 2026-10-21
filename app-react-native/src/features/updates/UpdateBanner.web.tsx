import { useEffect, useState } from "react";
import { useBroadcast } from "../session/BroadcastProvider";
import { UpdatePrompt } from "./UpdatePrompt";

/**
 * Desktop (Tauri) updates: Rust checks the signed update feed, downloads the installer and tells
 * this page when it is ready. Installing closes the app; the installer reopens it. The public web
 * page has no bridge and never shows this.
 */
export function UpdateBanner() {
    const desktop = typeof window !== "undefined" ? window.p2pcastDesktop : undefined;
    const { mode } = useBroadcast();
    const [update, setUpdate] = useState<DesktopUpdate | null>(null);
    const [dismissed, setDismissed] = useState<string | null>(null);
    const [installing, setInstalling] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!desktop?.getReadyUpdate) return;
        // The update may have been downloaded before this page started listening.
        void desktop.getReadyUpdate().then(ready => ready && setUpdate(ready)).catch(() => undefined);
        return desktop.onUpdateReady?.(setUpdate);
    }, [desktop]);

    if (!update || dismissed === update.version || !desktop?.installUpdate) return null;

    const live = mode === "starting" || mode === "broadcasting";
    const message = live
        ? "Encerre a transmissão para atualizar."
        : failed
            ? "Não deu para instalar agora. Tente de novo."
            : "O app fecha, atualiza e abre de novo em alguns segundos.";

    return (
        <UpdatePrompt
            title={`Versão ${update.version} pronta`}
            message={message}
            actionLabel="Atualizar"
            actionDisabled={live}
            loading={installing}
            onAction={() => {
                setInstalling(true);
                setFailed(false);
                desktop.installUpdate!().catch(() => {
                    setInstalling(false);
                    setFailed(true);
                });
            }}
            onDismiss={() => setDismissed(update.version)}
        />
    );
}
