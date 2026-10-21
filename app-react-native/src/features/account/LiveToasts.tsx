import { useEffect } from "react";
import { Text, View } from "react-native";
import { Button, IconButton } from "../../components/Button";
import { useAccount } from "./AccountProvider";

/** "Fulano está ao vivo" cards; each one dismisses itself after ten seconds. */
export function LiveToasts() {
    const account = useAccount();
    const notifications = account?.liveNotifications ?? [];
    const dismiss = account?.dismissLiveNotification;

    useEffect(() => {
        if (!dismiss || notifications.length === 0) return;
        const timers = notifications.map(user => setTimeout(() => dismiss(user.id, user.peerId), 10_000));
        return () => timers.forEach(clearTimeout);
    }, [dismiss, notifications]);

    if (!account || notifications.length === 0) return null;

    return (
        <View pointerEvents="box-none" className="absolute left-0 right-0 top-4 z-40 items-center gap-2 px-4" aria-live="polite">
            {notifications.map(user => (
                <View
                    key={`${user.id}:${user.peerId}`}
                    accessibilityRole="alert"
                    className="w-full max-w-sm flex-row items-center gap-3 rounded-panel border border-success/30 bg-panel-deep/95 p-3 shadow-2xl shadow-black"
                >
                    <View className="h-2 w-2 animate-pulse rounded-full bg-danger" />
                    <View className="flex-1 gap-0.5">
                        <Text className="text-[12px] font-extrabold text-ink">{user.username} está ao vivo</Text>
                        <Text className="text-[10px] text-muted" numberOfLines={1}>{user.activity || "Começou uma transmissão"}</Text>
                    </View>
                    <Button
                        size="sm"
                        label="Assistir"
                        onPress={() => {
                            account.dismissLiveNotification(user.id, user.peerId);
                            account.watch(user.peerId);
                        }}
                    />
                    <IconButton label="Dispensar" glyph="×" onPress={() => account.dismissLiveNotification(user.id, user.peerId)} />
                </View>
            ))}
        </View>
    );
}
