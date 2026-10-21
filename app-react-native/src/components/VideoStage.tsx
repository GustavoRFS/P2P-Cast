import { useRef, type ComponentRef, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { ChatState, MediaSources } from "../features/session/types";
import { ChatPanel } from "./ChatPanel";
import { VideoActions } from "./VideoActions";
import { VideoView } from "./VideoView";

/**
 * The 16:9 stage shared by broadcaster and viewer: the screen fills it, the camera floats on top
 * when both are sent, and the chat, badge and controls sit in the corners.
 */
export function VideoStage({
    media,
    badge,
    placeholder,
    muted = true,
    volume = 1,
    audioControl,
    extraActions,
    chat,
}: {
    media: MediaSources;
    badge: string;
    placeholder: ReactNode;
    muted?: boolean;
    volume?: number;
    audioControl?: ReactNode;
    extraActions?: ReactNode;
    chat: { title: string; state: ChatState; emptyLabel: string };
}) {
    const stageRef = useRef<ComponentRef<typeof View>>(null);
    const mainVideoRef = useRef<HTMLVideoElement | null>(null);
    const main = media.screen ?? media.camera;
    const overlay = media.screen && media.camera ? media.camera : null;

    return (
        <View ref={stageRef} className="relative aspect-video w-full overflow-hidden rounded-panel border border-line bg-black">
            {main ? (
                <VideoView source={main} muted={muted} volume={volume} videoRef={mainVideoRef} />
            ) : (
                <View className="flex-1 items-center justify-center gap-3">{placeholder}</View>
            )}

            {overlay && (
                <View className="absolute left-3 top-12 aspect-video w-[30%] overflow-hidden rounded-lg border border-accent/30 shadow-lg shadow-black md:w-1/4">
                    <VideoView source={overlay} muted={muted} volume={volume} fit="cover" />
                </View>
            )}

            {main && (
                <View className="absolute left-3 top-3 flex-row items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1">
                    <View className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                    <Text className="text-[9px] font-extrabold tracking-widest text-ink">{badge}</Text>
                </View>
            )}

            {main && (
                <View className="absolute right-3 top-3 z-10 flex-row gap-2">
                    {extraActions}
                    <VideoActions stageRef={stageRef} videoRef={mainVideoRef} />
                </View>
            )}

            {main && audioControl ? (
                <View className="absolute bottom-3 left-3 z-10 flex-row items-center gap-2 rounded-full bg-black/60 px-2 py-1">
                    {audioControl}
                </View>
            ) : null}

            <ChatPanel title={chat.title} chat={chat.state} emptyLabel={chat.emptyLabel} />
        </View>
    );
}
