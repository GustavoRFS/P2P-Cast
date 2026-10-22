import { useEffect, useState } from "react";
import { showDesktopNotice } from "../../lib/desktop-notice";
import { useBroadcast } from "../session/BroadcastProvider";
import { UpdatePrompt } from "./UpdatePrompt";

/**
 * Desktop (Tauri) updates: Rust checks the signed update feed (at startup and from the tray),
 * downloads the installer and tells this page when one has to wait. Installing closes the app; the
 * installer reopens it. Answers to the tray's "Verificar atualizações" go to the toast window, in
 * the corner chosen for live notifications. The public web page has no bridge and never shows this.
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
        const stopReady = desktop.onUpdateReady?.(setUpdate);
        const stopNotice = desktop.onUpdateNotice?.(notice => showDesktopNotice(notice.title, notice.message));
        return () => {
            stopReady?.();
            stopNotice?.();
        };
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
