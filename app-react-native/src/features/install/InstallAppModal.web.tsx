import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AppModal } from "../../components/AppModal";
import { Button } from "../../components/Button";
import {
    detectInstallTarget,
    findAppDownload,
    formatDownloadSize,
    RELEASES_PAGE_URL,
    type AppDownload,
    type InstallTarget,
} from "../../lib/app-downloads";
import { getAppPlatform } from "../../platform";

const SHOW_DELAY_MS = 1200;

const COPY: Record<InstallTarget, { title: string; subtitle: string; points: string[]; action: string; note?: string }> = {
    windows: {
        title: "P2P-Cast para Windows",
        subtitle: "Instale o app e transmita sem abrir o navegador.",
        points: [
            "Comece a live com um atalho, até de dentro do jogo.",
            "Fica no tray e avisa quando um amigo entra ao vivo.",
            "Atualiza sozinho.",
        ],
        action: "Baixar instalador",
    },
    android: {
        title: "P2P-Cast para Android",
        subtitle: "Instale o app e transmita sem depender do navegador.",
        points: [
            "Transmita a tela ou a câmera em segundo plano.",
            "Receba aviso quando um amigo entrar ao vivo.",
        ],
        action: "Baixar APK",
        note: "O Android pode pedir para você permitir a instalação de apps baixados pelo navegador.",
    },
};

/**
 * On the public web page, offers the app that fits the device: the Windows installer or the
 * Android APK, from the latest GitHub release. iOS, macOS and Linux get nothing (there is no app),
 * and neither does the page running inside the desktop app. The offer appears on every page load.
 */
export function InstallAppModal() {
    const [target, setTarget] = useState<InstallTarget | null>(null);
    const [download, setDownload] = useState<AppDownload | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (getAppPlatform() !== "web" || typeof navigator === "undefined") return;
        const detected = detectInstallTarget(navigator.userAgent, navigator.maxTouchPoints);
        if (!detected) return;
        let active = true;
        setTarget(detected);
        const lookup = findAppDownload(detected).catch(() => null);
        const timer = setTimeout(() => {
            void lookup.then(found => {
                if (!active) return;
                setDownload(found);
                setVisible(true);
            });
        }, SHOW_DELAY_MS);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, []);

    if (!target) return null;
    const copy = COPY[target];
    const size = download ? formatDownloadSize(download.size) : null;
    const close = () => setVisible(false);

    return (
        <AppModal
            visible={visible}
            onClose={close}
            title={copy.title}
            subtitle={copy.subtitle}
            footer={
                <>
                    <Button variant="ghost" label="Agora não" onPress={close} />
                    <Button
                        label={download ? copy.action : "Ver downloads"}
                        onPress={() => {
                            close();
                            // Same tab: the browser starts the download and the page stays put.
                            window.location.assign(download?.url ?? RELEASES_PAGE_URL);
                        }}
                    />
                </>
            }
        >
            <View className="gap-2">
                {copy.points.map(point => (
                    <View key={point} className="flex-row items-start gap-2">
                        <Text className="text-[12px] leading-5 text-accent">•</Text>
                        <Text className="flex-1 text-[12px] leading-5 text-ink-soft">{point}</Text>
                    </View>
                ))}
            </View>
            {download ? (
                <Text className="text-[10px] text-muted">
                    {[`Versão ${download.version}`, size, target === "windows" ? "Windows 10 ou 11" : "Android 8 ou mais novo"]
                        .filter(Boolean)
                        .join(" · ")}
                </Text>
            ) : null}
            {copy.note ? <Text className="text-[10px] leading-4 text-muted">{copy.note}</Text> : null}
        </AppModal>
    );
}
