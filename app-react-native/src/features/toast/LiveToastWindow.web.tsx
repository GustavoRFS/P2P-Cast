import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

const VISIBLE_MS = 6000;
const SLIDE_MS = 300;
// Cards on screen at once; a newer one pushes the oldest out. Rust sizes the window for as many.
const MAX_TOASTS = 4;
const APP_ICON = require("../../../assets/images/icon.png");

/** The broadcaster's picture (or initial) with the red live badge. */
function LiveAvatar({ toast }: { toast: DesktopLiveToast }) {
    return (
        <View className="relative">
            {toast.avatar ? (
                <Image source={{ uri: toast.avatar }} className="h-12 w-12 rounded-full" accessibilityIgnoresInvertColors />
            ) : (
                <View className="h-12 w-12 items-center justify-center rounded-full bg-accent/20">
                    <Text className="text-lg font-extrabold text-accent">{toast.username.slice(0, 1).toUpperCase()}</Text>
                </View>
            )}
            <View className="absolute -bottom-0.5 -right-0.5 h-4 w-4 items-center justify-center rounded-full border-2 border-panel-deep bg-danger">
                <View className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            </View>
        </View>
    );
}

/** One card of the stack: slides in, stays VISIBLE_MS (longer while hovered), slides out. */
function ToastCard({
    toast,
    fromLeft,
    onDone,
    onOpenLive,
}: {
    toast: DesktopLiveToast;
    fromLeft: boolean;
    onDone(id: number): void;
    onOpenLive(toast: DesktopLiveToast): void;
}) {
    const [shown, setShown] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const notice = typeof toast.message === "string";
    // Previews and app messages have no live behind them: a click just closes them.
    const opensLive = !toast.preview && !notice;

    useEffect(() => {
        // Start off-screen, then slide in on the next frame so the transition runs.
        const frame = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    const close = useCallback(() => {
        setLeaving(true);
        setShown(false);
        setTimeout(() => onDone(toast.id), SLIDE_MS);
    }, [onDone, toast.id]);

    useEffect(() => {
        if (!shown || hovered || leaving) return;
        const timer = setTimeout(close, VISIBLE_MS);
        return () => clearTimeout(timer);
    }, [close, hovered, leaving, shown]);

    const offscreen = fromLeft ? "-translate-x-[420px]" : "translate-x-[420px]";

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                notice
                    ? `${toast.username}. ${toast.message}. Fechar`
                    : toast.preview
                        ? "Prévia do aviso de live. Fechar"
                        : `${toast.username} iniciou uma live. Abrir a live`
            }
            onPress={() => (opensLive ? onOpenLive(toast) : close())}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            className={`h-[84px] w-full flex-row items-center gap-3 rounded-2xl border border-accent/25 bg-panel-deep/95 px-4 shadow-2xl shadow-black transition-all duration-300 ease-out hover:border-accent/60 hover:bg-panel-solid active:scale-[0.98] ${shown ? "translate-x-0 opacity-100" : `${offscreen} opacity-0`}`}
        >
            {notice ? (
                // A bundled image gets its file size as inline style on web, which beats classes.
                <Image source={APP_ICON} style={{ width: 48, height: 48 }} className="rounded-xl" accessibilityIgnoresInvertColors />
            ) : (
                <LiveAvatar toast={toast} />
            )}
            <View className="flex-1 gap-0.5">
                <Text className="text-[15px] font-extrabold text-ink" numberOfLines={1}>{toast.username}</Text>
                <Text className="text-[12px] leading-4 text-muted-bright" numberOfLines={notice ? 2 : 1}>
                    {notice ? toast.message : "Iniciou uma live"}
                </Text>
            </View>
        </Pressable>
    );
}

/**
 * Steam-style notifications, rendered alone in the Tauri toast window (transparent, always on
 * top, never focused). Up to MAX_TOASTS cards stack in the chosen corner, the newest against its
 * edge; each leaves on its own timer, and a newer one pushes the oldest out. Rust fits the window to
 * the stack. A live card opens the live on click; app messages use the same card with the app icon.
 */
export function LiveToastWindow() {
    // Oldest first.
    const [toasts, setToasts] = useState<DesktopLiveToast[]>([]);
    const seen = useRef(new Set<number>());

    const add = useCallback((toast: DesktopLiveToast | null) => {
        if (!toast || seen.current.has(toast.id)) return;
        seen.current.add(toast.id);
        setToasts(existing => [...existing, toast].slice(-MAX_TOASTS));
    }, []);

    useEffect(() => {
        const unlisten = listen<DesktopLiveToast>("live-toast", event => add(event.payload));
        // A toast can arrive while this page is still loading; Rust keeps it until asked.
        void invoke<DesktopLiveToast | null>("take_pending_live_toast").then(add).catch(() => undefined);
        return () => {
            void unlisten.then(remove => remove());
        };
    }, [add]);

    const corner = toasts.at(-1)?.corner ?? "bottom-right";
    // Nothing to lay out before the first card: an empty layout would also drop a toast Rust is
    // still holding for this page.
    const laidOut = useRef(false);

    useEffect(() => {
        if (toasts.length === 0 && !laidOut.current) return;
        laidOut.current = true;
        void invoke("layout_live_toasts", { count: toasts.length, corner }).catch(() => undefined);
    }, [corner, toasts.length]);

    const remove = useCallback((id: number) => {
        setToasts(existing => existing.filter(toast => toast.id !== id));
    }, []);

    const openLive = useCallback((toast: DesktopLiveToast) => {
        // Rust hides this window and brings the app up on that live.
        void invoke("open_live_from_toast", { peerId: toast.peerId }).catch(() => undefined);
        setToasts([]);
    }, []);

    if (toasts.length === 0) return <View className="h-full w-full bg-transparent" />;

    const fromLeft = corner.endsWith("left");
    const fromTop = corner.startsWith("top");
    // The newest sits against the corner's edge: last for bottom corners, first for top ones.
    const ordered = fromTop ? [...toasts].reverse() : toasts;

    return (
        <View className={`h-full w-full gap-2 bg-transparent p-2 ${fromTop ? "justify-start" : "justify-end"} ${fromLeft ? "items-start" : "items-end"}`}>
            {ordered.map(toast => (
                <ToastCard key={toast.id} toast={toast} fromLeft={fromLeft} onDone={remove} onOpenLive={openLive} />
            ))}
        </View>
    );
}
