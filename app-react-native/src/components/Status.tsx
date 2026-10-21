import { Text, View } from "react-native";
import type { AppError, StreamMode } from "../lib/types";
import { Button } from "./Button";

export const MODE_LABELS: Record<StreamMode, string> = {
    idle: "Pronto para começar",
    starting: "Preparando transmissão",
    broadcasting: "Transmissão ativa",
    connecting: "Conectando à transmissão",
    watching: "Assistindo ao vivo",
    error: "A conexão precisa de atenção",
};

export function StatusPill({ mode }: { mode: StreamMode }) {
    const live = mode === "broadcasting" || mode === "watching";

    return (
        <View className={`flex-row items-center gap-2 self-start rounded-full border px-3 py-2 ${live ? "border-success/25 bg-success/5" : "border-line bg-white/5"}`}>
            <View className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-success" : "bg-info"}`} />
            <Text className={`text-[10px] font-extrabold uppercase tracking-widest ${live ? "text-success" : "text-muted-bright"}`}>
                {MODE_LABELS[mode]}
            </Text>
        </View>
    );
}

export function ErrorCard({
    error,
    onRetry,
    onDismiss,
}: {
    error: AppError;
    onRetry?: () => void;
    onDismiss?: () => void;
}) {
    return (
        <View accessibilityRole="alert" className="flex-row gap-3 rounded-panel border border-danger/30 bg-[#1a1420]/95 p-4">
            <View className="h-7 w-7 items-center justify-center rounded-full bg-danger/20">
                <Text className="text-sm font-extrabold text-danger">!</Text>
            </View>
            <View className="flex-1 gap-1.5">
                <Text className="text-[13px] font-extrabold text-[#ffdada]">{error.title}</Text>
                <Text className="text-[12px] leading-5 text-[#d9aeb5]">{error.message}</Text>
                {(onRetry || onDismiss) && (
                    <View className="mt-1 flex-row flex-wrap gap-2">
                        {onRetry && <Button size="sm" variant="secondary" label="Tentar novamente" onPress={onRetry} />}
                        {onDismiss && <Button size="sm" variant="ghost" label="Fechar" onPress={onDismiss} />}
                    </View>
                )}
            </View>
        </View>
    );
}
