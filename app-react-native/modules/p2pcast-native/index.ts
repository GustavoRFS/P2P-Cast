import { requireNativeView, requireOptionalNativeModule, type NativeModule } from "expo";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export type NativeStreamMode = "idle" | "starting" | "broadcasting" | "connecting" | "watching" | "error";
export type NativeError = { title: string; message: string } | null;
export type NativeTrack = { trackId: string; hasAudio: boolean } | null;

export type BroadcastStateEvent = {
    mode: NativeStreamMode;
    error: NativeError;
    shareUrl: string | null;
    viewerCount: number;
    audioMuted: boolean;
    screen: NativeTrack;
    camera: NativeTrack;
};

export type ViewerStateEvent = {
    mode: NativeStreamMode;
    error: NativeError;
    screen: NativeTrack;
    camera: NativeTrack;
};

export type NativeChatMessage = {
    id: string;
    authorName: string;
    text: string;
    timestamp: number;
    isBroadcaster: boolean;
    isSelf: boolean;
};

export type ChatEvent = { canSend: boolean; messages: NativeChatMessage[] };

type Events = {
    onBroadcastState(event: BroadcastStateEvent): void;
    onBroadcastChat(event: ChatEvent): void;
    onViewerState(event: ViewerStateEvent): void;
    onViewerChat(event: ChatEvent): void;
};

/** The Kotlin capture/WebRTC engine (modules/p2pcast-native/android). */
declare class P2PCastNativeModule extends NativeModule<Events> {
    requestScreenCapture(): Promise<boolean>;
    startBroadcast(settings: Record<string, unknown>): Promise<void>;
    stopBroadcast(): void;
    setBroadcastAudioMuted(muted: boolean): void;
    flipCamera(): void;
    sendBroadcastChat(text: string): void;
    startViewer(broadcastId: string): void;
    retryViewer(): void;
    stopViewer(): void;
    sendViewerChat(text: string, name: string | null): void;
    setViewerAudio(enabled: boolean, volume: number): void;
}

/** Null where the module is not linked (Expo Go, or a build without the native code). */
export const P2PCastNative = requireOptionalNativeModule<P2PCastNativeModule>("P2PCastNative");

export type NativeVideoViewProps = ViewProps & {
    trackId: string | null;
    fit?: "contain" | "cover";
    mirror?: boolean;
    overlay?: boolean;
};

let videoView: ComponentType<NativeVideoViewProps> | null | undefined;

/** The native renderer, resolved lazily so screens can render a fallback when it is missing. */
export function getNativeVideoView(): ComponentType<NativeVideoViewProps> | null {
    if (videoView === undefined) {
        try {
            videoView = P2PCastNative ? requireNativeView<NativeVideoViewProps>("P2PCastVideoView") : null;
        } catch {
            videoView = null;
        }
    }
    return videoView;
}
