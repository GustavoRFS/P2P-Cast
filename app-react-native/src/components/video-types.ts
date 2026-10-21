import type { VideoSource } from "../features/session/types";

export type VideoViewProps = {
    source: VideoSource | null;
    muted?: boolean;
    volume?: number;
    fit?: "contain" | "cover";
    className?: string;
};
