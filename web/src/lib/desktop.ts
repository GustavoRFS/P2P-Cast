import type { CaptureSettings } from "./capture";
import { buildDisplayMediaVideoConstraints } from "./capture";

export type DesktopWindow = {
    id: string;
    name: string;
    thumbnailDataUrl: string;
};

export type DesktopConfig = {
    backendUrl: string;
    webUrl: string;
    appOrigin: "p2pcast-app://desktop";
    isolatedAudioAvailable: boolean;
};

const desktopCaptureReleases = new WeakMap<MediaStream, () => void>();

export function isDesktopApp(): boolean {
    return typeof window !== "undefined" && Boolean(window.p2pcastDesktop);
}

export async function getDesktopConfig(): Promise<DesktopConfig | null> {
    return window.p2pcastDesktop ? window.p2pcastDesktop.getConfig() : null;
}

export async function listDesktopWindows(): Promise<DesktopWindow[]> {
    if (!window.p2pcastDesktop) return [];
    return window.p2pcastDesktop.getWindowSources();
}

export function releaseDesktopCapture(stream: MediaStream | null): void {
    if (!stream) return;
    desktopCaptureReleases.get(stream)?.();
    desktopCaptureReleases.delete(stream);
}

export async function captureDesktopWindow(sourceId: string, settings: CaptureSettings): Promise<MediaStream> {
    const desktop = window.p2pcastDesktop;
    if (!desktop) throw new Error("A seleção de janela só funciona no app desktop.");
    const desktopConfig = await desktop.getConfig();
    if (settings.audio && !desktopConfig.isolatedAudioAvailable) {
        throw new Error("O áudio isolado deste aplicativo está disponível no Windows quando o capturador nativo está instalado.");
    }

    await desktop.selectWindow(sourceId);
    const videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: buildDisplayMediaVideoConstraints(settings),
        audio: false,
    });
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack) {
        videoStream.getTracks().forEach(track => track.stop());
        throw new Error("O sistema não retornou vídeo para a janela selecionada.");
    }

    let audioContext: AudioContext | null = null;
    let captureId: string | null = null;
    let removeAudioDataListener = () => {};
    let removeAudioErrorListener = () => {};
    let destination: MediaStreamAudioDestinationNode | null = null;
    let released = false;
    let nextAudioTime = 0;

    const release = () => {
        if (released) return;
        released = true;
        removeAudioDataListener();
        removeAudioErrorListener();
        if (captureId) void desktop.stopApplicationAudio(captureId).catch(() => undefined);
        if (audioContext && audioContext.state !== "closed") void audioContext.close().catch(() => undefined);
    };

    try {
        const stream = new MediaStream(videoStream.getVideoTracks());
        if (settings.audio) {
            const started = await desktop.startApplicationAudio(sourceId);
            captureId = started.captureId;
            audioContext = new AudioContext({ sampleRate: started.format.sampleRate });
            await audioContext.resume();
            destination = audioContext.createMediaStreamDestination();
            nextAudioTime = audioContext.currentTime + 0.03;

            removeAudioDataListener = desktop.onApplicationAudioData(captureId, chunk => {
                if (!audioContext || !destination || released || chunk.byteLength < 8 || chunk.byteLength % 8 !== 0) return;
                const interleaved = new Float32Array(chunk);
                const frames = interleaved.length / 2;
                const buffer = audioContext.createBuffer(2, frames, started.format.sampleRate);
                const left = buffer.getChannelData(0);
                const right = buffer.getChannelData(1);
                for (let frame = 0; frame < frames; frame += 1) {
                    left[frame] = interleaved[frame * 2];
                    right[frame] = interleaved[frame * 2 + 1];
                }

                const source = audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(destination);
                const startAt = Math.max(audioContext.currentTime + 0.01, nextAudioTime);
                source.start(startAt);
                nextAudioTime = startAt + buffer.duration;
                source.onended = () => source.disconnect();
            });

            removeAudioErrorListener = desktop.onApplicationAudioError(captureId, message => {
                release();
                window.dispatchEvent(new CustomEvent("p2pcast:application-audio-error", { detail: message }));
            });
            await desktop.resumeApplicationAudio(captureId);
            destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        }

        stream.getVideoTracks().forEach(track => track.addEventListener("ended", release, { once: true }));
        stream.getAudioTracks().forEach(track => track.addEventListener("ended", release, { once: true }));
        desktopCaptureReleases.set(stream, release);
        return stream;
    } catch (error) {
        release();
        videoStream.getTracks().forEach(track => track.stop());
        throw error;
    }
}
