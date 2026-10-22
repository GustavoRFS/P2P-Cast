import type { Dispatch, SetStateAction } from "react";
import type { CaptureSettings, CaptureTrackSource } from "../../lib/capture";
import type { ChatMessage } from "../../lib/chat";
import type { ShortcutProfile } from "../../lib/shortcut-profiles";
import type { DesktopConfig } from "../../lib/desktop";
import type { AppError, StreamMode } from "../../lib/types";

/** A track the UI can render: a MediaStream on web, a handle to a native track on Android. */
export type NativeTrackRef = { nativeTrackId: string; hasAudio: boolean };
export type VideoSource = MediaStream | NativeTrackRef;

export type MediaSources = Record<CaptureTrackSource, VideoSource | null>;

export const EMPTY_MEDIA_SOURCES: MediaSources = { screen: null, camera: null };

export interface DisplayChatMessage extends ChatMessage {
    isSelf: boolean;
}

export type ChatState = {
    messages: DisplayChatMessage[];
    open: boolean;
    unread: number;
    soundEnabled: boolean;
    ready: boolean;
    toggle(): void;
    toggleSound(): void;
    send(text: string): void;
    /** Viewer only: the name shown to the others. */
    name?: string;
    setName?(name: string): void;
};

/** A live the desktop app encodes and sends itself (direct capture), with no local preview. */
export type NativeSenderInfo = {
    /** Known once the first frame is encoded. */
    encoder: { name: string; hardware: boolean; width: number; height: number; fps: number; bitrate: number } | null;
};

export type DesktopState = {
    config: DesktopConfig | null;
    captureTargets: DesktopCaptureTarget[];
    refreshTargets(): void;
    shortcutProfiles: ShortcutProfile[];
    setShortcutProfiles(profiles: ShortcutProfile[]): void;
    /** The profile the live was started with or last switched to. */
    activeProfile: ShortcutProfile | null;
    /** Starts a live with a profile, as its shortcut would (the button on its card). */
    startProfile(profileId: string): void;
    /** Moves the running live to another profile, as a second press of its shortcut would. */
    switchProfile(profileId: string): void;
};

export type BroadcastSession = {
    mode: StreamMode;
    error: AppError | null;
    clearError(): void;
    settings: CaptureSettings;
    setSettings: Dispatch<SetStateAction<CaptureSettings>>;
    shareUrl: string | null;
    copied: boolean;
    viewerCount: number;
    audioMuted: boolean;
    localMedia: MediaSources;
    chat: ChatState;
    /** Manual start from the UI (web and Android); desktop starts only from shortcuts. */
    start(settings?: CaptureSettings): Promise<void>;
    stop(): void;
    toggleAudio(): void;
    flipCamera(): Promise<void>;
    copyShareUrl(): Promise<void>;
    /** Present only inside the Tauri shell. */
    desktop: DesktopState | null;
    /** Set while the desktop app sends the live natively. */
    nativeSender?: NativeSenderInfo | null;
};

export type ViewerSession = {
    mode: StreamMode;
    error: AppError | null;
    remoteMedia: MediaSources;
    audioOn: boolean;
    volume: number;
    chat: ChatState;
    toggleAudio(): void;
    setVolume(volume: number): void;
    retry(): void;
};
