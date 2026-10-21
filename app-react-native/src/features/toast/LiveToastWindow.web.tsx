import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

const VISIBLE_MS = 6000;
const SLIDE_MS = 300;

/**
 * Steam-style live notification, rendered alone in the Tauri toast window (transparent,
 * always on top, never focused). Rust places the window in the chosen corner; this page slides the
 * card in, queues bursts one at a time, pauses while hovered and opens the live on click.
 */
export function LiveToastWindow() {
    const [queue, setQueue] = useState<DesktopLiveToast[]>([]);
    const [shown, setShown] = useState(false);
    const [hovered, setHovered] = useState(false);
    const seen = useRef(new Set<number>());
    const current = queue[0] ?? null;

    const enqueue = useCallback((toast: DesktopLiveToast | null) => {
        if (!toast || seen.current.has(toast.id)) return;
        seen.current.add(toast.id);
        setQueue(existing => [...existing, toast]);
    }, []);

    useEffect(() => {
        const unlisten = listen<DesktopLiveToast>("live-toast", event => enqueue(event.payload));
        // A toast can arrive while this page is still loading; Rust keeps it until asked.
        void invoke<DesktopLiveToast | null>("take_pending_live_toast").then(enqueue).catch(() => undefined);
        return () => {
            void unlisten.then(remove => remove());
        };
    }, [enqueue]);

    useEffect(() => {
        if (!current) {
            void invoke("hide_live_toast").catch(() => undefined);
            return;
        }
        // Start off-screen, then slide in on the next frame so the transition runs.
        setShown(false);
        const frame = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(frame);
    }, [current]);

    const dismiss = useCallback(() => {
        setShown(false);
        setTimeout(() => setQueue(existing => existing.slice(1)), SLIDE_MS);
    }, []);

    useEffect(() => {
        if (!current || !shown || hovered) return;
        const timer = setTimeout(dismiss, VISIBLE_MS);
        return () => clearTimeout(timer);
    }, [current, dismiss, hovered, shown]);

    if (!current) return <View className="h-full w-full bg-transparent" />;

    const fromLeft = current.corner.endsWith("left");
    const offscreen = fromLeft ? "-translate-x-[420px]" : "translate-x-[420px]";

    return (
        <View className={`h-full w-full justify-center bg-transparent p-2 ${fromLeft ? "items-start" : "items-end"}`}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={current.preview ? "Prévia do aviso de live. Fechar" : `${current.username} iniciou uma live. Abrir a live`}
                onPress={() => {
                    // A preview has no live behind it: the click just closes it.
                    if (!current.preview) {
                        void invoke("open_live_from_toast", { peerId: current.peerId }).catch(() => undefined);
                    }
                    setShown(false);
                    setQueue([]);
                }}
                onHoverIn={() => setHovered(true)}
                onHoverOut={() => setHovered(false)}
                className={`w-full flex-row items-center gap-3 rounded-2xl border border-accent/25 bg-panel-deep/95 px-4 py-3 shadow-2xl shadow-black transition-all duration-300 ease-out hover:border-accent/60 hover:bg-panel-solid active:scale-[0.98] ${shown ? "translate-x-0 opacity-100" : `${offscreen} opacity-0`}`}
            >
                <View className="relative">
                    {current.avatar ? (
                        <Image source={{ uri: current.avatar }} className="h-12 w-12 rounded-full" accessibilityIgnoresInvertColors />
                    ) : (
                        <View className="h-12 w-12 items-center justify-center rounded-full bg-accent/20">
                            <Text className="text-lg font-extrabold text-accent">{current.username.slice(0, 1).toUpperCase()}</Text>
                        </View>
                    )}
                    <View className="absolute -bottom-0.5 -right-0.5 h-4 w-4 items-center justify-center rounded-full border-2 border-panel-deep bg-danger">
                        <View className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    </View>
                </View>
                <View className="flex-1 gap-0.5">
                    <Text className="text-[15px] font-extrabold text-ink" numberOfLines={1}>{current.username}</Text>
                    <Text className="text-[12px] text-muted-bright" numberOfLines={1}>Iniciou uma live</Text>
                </View>
            </Pressable>
        </View>
    );
}
