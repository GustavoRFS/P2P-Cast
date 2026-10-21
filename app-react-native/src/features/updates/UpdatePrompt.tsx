import { Text, View } from "react-native";
import { Button, IconButton } from "../../components/Button";

/** The "new version ready" card, shared by the desktop updater and EAS Update on Android. */
export function UpdatePrompt({
    title,
    message,
    actionLabel,
    actionDisabled = false,
    loading = false,
    onAction,
    onDismiss,
}: {
    title: string;
    message: string;
    actionLabel: string;
    actionDisabled?: boolean;
    loading?: boolean;
    onAction(): void;
    onDismiss(): void;
}) {
    return (
        <View pointerEvents="box-none" className="absolute bottom-6 left-4 right-4 z-40 items-start sm:right-auto">
            <View className="w-full max-w-[360px] flex-row items-center gap-3 rounded-panel border border-accent/30 bg-panel-deep/95 p-3 shadow-2xl shadow-black">
                <View className="flex-1 gap-0.5">
                    <Text className="text-[12px] font-extrabold text-ink">{title}</Text>
                    <Text className="text-[10px] leading-4 text-muted">{message}</Text>
                </View>
                <Button size="sm" label={actionLabel} disabled={actionDisabled} loading={loading} onPress={onAction} />
                <IconButton label="Depois" glyph="×" onPress={onDismiss} />
            </View>
        </View>
    );
}
