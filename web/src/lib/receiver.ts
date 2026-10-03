export interface NegotiationStream {
    stream: MediaStream;
    dispose(): void;
}

export function createNegotiationStream(): NegotiationStream {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;

    const videoSource = canvas.captureStream(1);
    const tracks = [...videoSource.getVideoTracks()];
    let audioContext: AudioContext | undefined;
    let oscillator: OscillatorNode | undefined;

    if (typeof AudioContext !== "undefined") {
        audioContext = new AudioContext();
        oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();

        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        tracks.push(...destination.stream.getAudioTracks());
    }

    const stream = new MediaStream(tracks);

    return {
        stream,
        dispose() {
            stream.getTracks().forEach(track => track.stop());
            videoSource.getTracks().forEach(track => track.stop());
            oscillator?.stop();
            if (audioContext) void audioContext.close();
        },
    };
}
