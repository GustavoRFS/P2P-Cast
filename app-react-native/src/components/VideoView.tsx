import { Text, View } from "react-native";
import type { VideoViewProps } from "./video-types";

// Provisional: replaced by the native track renderer from the Android module.
export function VideoView({ className = "" }: VideoViewProps & { videoRef?: unknown }) {
    return (
        <View className={`h-full w-full items-center justify-center bg-black ${className}`}>
            <Text className="text-xs text-muted">Vídeo nativo indisponível neste build</Text>
        </View>
    );
}
