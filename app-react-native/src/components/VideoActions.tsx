import type { ComponentRef, RefObject } from "react";
import type { View } from "react-native";

// Fullscreen and Picture-in-Picture are browser features; on Android the player owns them.
export function VideoActions(_props: { stageRef: RefObject<ComponentRef<typeof View> | null>; videoRef: RefObject<unknown> }) {
    return null;
}
