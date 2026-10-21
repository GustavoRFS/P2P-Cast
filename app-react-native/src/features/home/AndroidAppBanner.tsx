import { useEffect, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { Button, IconButton } from "../../components/Button";

const DISMISSED_KEY = "p2pcast.android-banner-dismissed";

function isAndroidBrowser(): boolean {
    return Platform.OS === "web" && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/** Suggests the Android app to people opening the web page on an Android phone. */
export function AndroidAppBanner() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!isAndroidBrowser()) return;
        try {
            if (window.localStorage.getItem(DISMISSED_KEY) === "1") return;
        } catch {
            // Storage can be unavailable in private browsing or restrictive contexts.
        }
        setVisible(true);
    }, []);

    if (!visible) return null;

    const dismiss = () => {
        setVisible(false);
        try {
            window.localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
            // Storage can be unavailable in private browsing or restrictive contexts.
        }
    };

    return (
        <View className="flex-row items-center gap-3 rounded-panel border border-accent/25 bg-accent/10 p-3">
            <Text className="text-xl">📲</Text>
            <View className="flex-1 gap-0.5">
                <Text className="text-[12px] font-extrabold text-ink">Use o app Android</Text>
                <Text className="text-[10px] text-muted">Transmita em segundo plano, sem depender do navegador.</Text>
            </View>
            <Button size="sm" label="Baixar" onPress={() => void Linking.openURL("/downloads/p2pcast.apk")} />
            <IconButton label="Fechar aviso" glyph="×" onPress={dismiss} />
        </View>
    );
}
