import type { MediaSources, VideoSource } from "./types";

export function sourceHasAudio(source: VideoSource | null): boolean {
    if (!source) return false;
    if (typeof MediaStream !== "undefined" && source instanceof MediaStream) return source.getAudioTracks().length > 0;
    return "hasAudio" in source && source.hasAudio;
}

export function mediaHasAudio(media: MediaSources): boolean {
    return sourceHasAudio(media.screen) || sourceHasAudio(media.camera);
}

export function hasAnyMedia(media: MediaSources): boolean {
    return Boolean(media.screen || media.camera);
}
