import { useEffect, useRef, type Ref } from "react";
import type { VideoViewProps } from "./video-types";

/** Renders a MediaStream in a <video>; muted and volume follow the props. */
export function VideoView({
    source,
    muted = true,
    volume = 1,
    fit = "contain",
    className = "",
    videoRef,
}: VideoViewProps & { videoRef?: Ref<HTMLVideoElement> }) {
    const localRef = useRef<HTMLVideoElement | null>(null);

    const setRef = (element: HTMLVideoElement | null) => {
        localRef.current = element;
        if (typeof videoRef === "function") videoRef(element);
        else if (videoRef) (videoRef as { current: HTMLVideoElement | null }).current = element;
    };

    useEffect(() => {
        const video = localRef.current;
        if (!video) return;
        video.srcObject = source instanceof MediaStream ? source : null;
        return () => {
            video.srcObject = null;
        };
    }, [source]);

    useEffect(() => {
        const video = localRef.current;
        if (!video) return;
        video.muted = muted;
        video.volume = volume;
        // Unmuting needs an explicit play() once the browser has blocked autoplay with sound.
        if (video.srcObject) void video.play().catch(() => undefined);
    }, [muted, volume, source]);

    return (
        <video
            ref={setRef}
            autoPlay
            playsInline
            muted={muted}
            className={`h-full w-full bg-black ${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
        />
    );
}
