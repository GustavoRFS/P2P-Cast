import type { CaptureSettings } from "./capture";
import { buildDisplayMediaVideoConstraints, RESOLUTION_OPTIONS } from "./capture";
import type { ShortcutCaptureMethod } from "./shortcut-profiles";

export type DesktopWindow = {
    id: string;
    name: string;
    thumbnailDataUrl: string;
};

export type DesktopConfig = {
    host: "electron" | "tauri";
    backendUrl: string;
    webUrl: string;
    appOrigin: string;
    isolatedAudioAvailable: boolean;
    directVideoCaptureAvailable?: boolean;
    capturePicker: "window-list" | "system-window";
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

export async function listDesktopCaptureTargets(): Promise<DesktopCaptureTarget[]> {
    return window.p2pcastDesktop?.listCaptureTargets?.() ?? [];
}

export async function resolveDesktopCaptureTarget(selector: string): Promise<DesktopCaptureTarget | null> {
    return window.p2pcastDesktop?.resolveCaptureTarget?.(selector) ?? null;
}

export function releaseDesktopCapture(stream: MediaStream | null): void {
    if (!stream) return;
    desktopCaptureReleases.get(stream)?.();
    desktopCaptureReleases.delete(stream);
}

function resolvedCanvasSize(width: number, height: number, resolution: CaptureSettings["resolution"]): [number, number] {
    const option = RESOLUTION_OPTIONS.find(candidate => candidate.value === resolution);
    if (!option?.width || !option.height) return [width, height];
    const scale = Math.min(1, option.width / width, option.height / height);
    return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

export async function captureDesktopWindow(
    sourceId: string,
    settings: CaptureSettings,
    desktopConfig: DesktopConfig,
    options: { audioSourceId?: string; captureMethod?: ShortcutCaptureMethod; targetKind?: "window" | "monitor" } = {},
): Promise<MediaStream> {
    const desktop = window.p2pcastDesktop;
    if (!desktop) throw new Error("A seleção de janela só funciona no app desktop.");
    if (settings.audio && !desktopConfig.isolatedAudioAvailable) {
        throw new Error("O áudio isolado do aplicativo está disponível apenas no Electron para Windows com o capturador nativo instalado.");
    }

    let directCaptureId: string | null = null;
    let removeDirectFrameListener = () => {};
    let removeDirectErrorListener = () => {};
    const disposeDirectCapture = () => {
        removeDirectFrameListener();
        removeDirectErrorListener();
        if (directCaptureId) void desktop.stopDirectVideoCapture?.(directCaptureId).catch(() => undefined);
        directCaptureId = null;
    };
    let videoStream: MediaStream;
    if (desktopConfig.host === "tauri" && options.captureMethod === "direct") {
        if (!desktop.startDirectVideoCapture || !desktop.resumeDirectVideoCapture || !desktop.stopDirectVideoCapture
            || !desktop.onDirectVideoFrame || !desktop.onDirectVideoError) {
            throw new Error("A captura direta WGC não está disponível neste build do Tauri.");
        }
        const started = await desktop.startDirectVideoCapture(sourceId, { fps: settings.fps, cursor: settings.cursor });
        directCaptureId = started.captureId;
        const sourceCanvas = document.createElement("canvas");
        const sourceContext = sourceCanvas.getContext("2d", { alpha: false });
        const outputCanvas = document.createElement("canvas");
        const outputContext = outputCanvas.getContext("2d", { alpha: false });
        if (!sourceContext || !outputContext) {
            await desktop.stopDirectVideoCapture(started.captureId);
            throw new Error("O navegador do Tauri não disponibilizou canvas para adaptar o vídeo capturado.");
        }
        sourceCanvas.width = started.width;
        sourceCanvas.height = started.height;
        const [initialWidth, initialHeight] = resolvedCanvasSize(started.width, started.height, settings.resolution);
        outputCanvas.width = initialWidth;
        outputCanvas.height = initialHeight;
        const outputStream = outputCanvas.captureStream(settings.fps);
        videoStream = outputStream;
        removeDirectFrameListener = desktop.onDirectVideoFrame(started.captureId, frame => {
            if (frame.buffer.byteLength !== frame.width * frame.height * 4) return;
            if (sourceCanvas.width !== frame.width || sourceCanvas.height !== frame.height) {
                sourceCanvas.width = frame.width;
                sourceCanvas.height = frame.height;
            }
            const [width, height] = resolvedCanvasSize(frame.width, frame.height, settings.resolution);
            if (outputCanvas.width !== width || outputCanvas.height !== height) {
                outputCanvas.width = width;
                outputCanvas.height = height;
            }
            sourceContext.putImageData(new ImageData(new Uint8ClampedArray(frame.buffer), frame.width, frame.height), 0, 0);
            outputContext.drawImage(sourceCanvas, 0, 0, width, height);
        });
        removeDirectErrorListener = desktop.onDirectVideoError(started.captureId, message => {
            window.dispatchEvent(new CustomEvent("p2pcast:direct-video-error", { detail: message }));
        });
        try {
            await desktop.resumeDirectVideoCapture(started.captureId);
        } catch (error) {
            outputStream.getTracks().forEach(track => track.stop());
            await desktop.stopDirectVideoCapture(started.captureId).catch(() => undefined);
            directCaptureId = null;
            removeDirectFrameListener();
            removeDirectErrorListener();
            throw error;
        }
    } else {
        if (desktopConfig.capturePicker === "window-list") await desktop.selectWindow(sourceId);
        const pickerOptions = desktopConfig.capturePicker === "system-window"
            ? {
                monitorTypeSurfaces: options.captureMethod === "windows-picker" ? "include" : "exclude",
                selfBrowserSurface: "exclude",
                systemAudio: "exclude",
            }
            : { monitorTypeSurfaces: "include", systemAudio: "exclude" };
        videoStream = await navigator.mediaDevices.getDisplayMedia({
            video: buildDisplayMediaVideoConstraints(settings),
            audio: false,
            ...pickerOptions,
        } as DisplayMediaStreamOptions);
        videoStream.getAudioTracks().forEach(track => track.stop());
    }
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack) {
        videoStream.getTracks().forEach(track => track.stop());
        disposeDirectCapture();
        throw new Error("O sistema não retornou vídeo para a janela selecionada.");
    }
    const expectedSurface = options.targetKind === "monitor" ? "monitor" : "window";
    if (!(desktopConfig.host === "tauri" && options.captureMethod === "direct")
        && desktopConfig.capturePicker === "system-window"
        && videoTrack.getSettings().displaySurface !== expectedSurface) {
        videoStream.getTracks().forEach(track => track.stop());
        disposeDirectCapture();
        throw new Error(expectedSurface === "monitor"
            ? "Escolha um monitor no seletor do Windows."
            : "Escolha uma janela de aplicativo no seletor do Windows.");
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
        disposeDirectCapture();
        removeAudioDataListener();
        removeAudioErrorListener();
        if (captureId) void desktop.stopApplicationAudio(captureId).catch(() => undefined);
        if (audioContext && audioContext.state !== "closed") void audioContext.close().catch(() => undefined);
    };

    try {
        const stream = new MediaStream(videoStream.getVideoTracks());
        if (settings.audio) {
            const started = await desktop.startApplicationAudio(options.audioSourceId ?? sourceId);
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
