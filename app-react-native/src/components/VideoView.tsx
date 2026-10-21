import { StyleSheet, Text, View } from "react-native";
import { getNativeVideoView } from "../../modules/p2pcast-native";
import type { VideoViewProps } from "./video-types";

/** Android: a SurfaceViewRenderer from the native module, fed by the track id. */
export function VideoView({ source, fit = "contain", overlay = false, className = "" }: VideoViewProps & { videoRef?: unknown }) {
    const NativeVideoView = getNativeVideoView();
    const trackId = source && "nativeTrackId" in source ? source.nativeTrackId : null;

    return (
        <View className={`h-full w-full bg-black ${className}`}>
            {NativeVideoView ? (
                <NativeVideoView trackId={trackId} fit={fit} overlay={overlay} style={StyleSheet.absoluteFill} />
            ) : (
                <View className="flex-1 items-center justify-center">
                    <Text className="text-xs text-muted">Vídeo nativo indisponível neste build</Text>
                </View>
            )}
        </View>
    );
}
