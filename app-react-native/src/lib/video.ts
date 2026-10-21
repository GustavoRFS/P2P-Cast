export function toggleVideoAudio(
    video: Pick<HTMLVideoElement, "muted">,
    audioOn: boolean,
): boolean {
    const nextAudioOn = !audioOn;
    video.muted = !nextAudioOn;
    return nextAudioOn;
}
