import type { VideoSource } from "../features/session/types";

export type VideoViewProps = {
    source: VideoSource | null;
    muted?: boolean;
    volume?: number;
    fit?: "contain" | "cover";
    /** Drawn above another video (Android needs this for stacked SurfaceViews). */
    overlay?: boolean;
    className?: string;
};
