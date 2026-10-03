export interface ChatNotificationAudioContext {
    readonly currentTime: number;
    readonly destination: AudioNode;
    createGain(): GainNode;
    createOscillator(): OscillatorNode;
    resume(): Promise<void>;
    close(): Promise<void>;
}

type AudioContextFactory = () => ChatNotificationAudioContext | null;

export interface ChatNotificationPlayer {
    unlock(): Promise<void>;
    play(): Promise<void>;
    dispose(): Promise<void>;
}

function createBrowserAudioContext(): ChatNotificationAudioContext | null {
    if (typeof window === "undefined") return null;

    const AudioContextConstructor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return null;

    return new AudioContextConstructor();
}

export function createChatNotificationPlayer(
    createContext: AudioContextFactory = createBrowserAudioContext,
): ChatNotificationPlayer {
    let context: ChatNotificationAudioContext | null = null;
    let disposed = false;

    const getContext = () => {
        if (disposed) return null;
        context ??= createContext();
        return context;
    };

    return {
        async unlock() {
            const audioContext = getContext();
            if (!audioContext) return;

            try {
                await audioContext.resume();
            } catch {
                // Browser autoplay policies may reject resume until a user gesture.
            }
        },
        async play() {
            const audioContext = getContext();
            if (!audioContext) return;

            try {
                await audioContext.resume();

                const startAt = audioContext.currentTime;
                const endAt = startAt + 0.16;
                const gain = audioContext.createGain();
                const oscillator = audioContext.createOscillator();

                gain.gain.setValueAtTime(0.0001, startAt);
                gain.gain.exponentialRampToValueAtTime(0.15, startAt + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
                oscillator.type = "sine";
                oscillator.frequency.setValueAtTime(660, startAt);
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start(startAt);
                oscillator.stop(endAt);
            } catch {
                // Audio is an enhancement; an unavailable device must not break chat.
            }
        },
        async dispose() {
            disposed = true;
            if (!context) return;

            const audioContext = context;
            context = null;
            try {
                await audioContext.close();
            } catch {
                // The context may already be closed by the browser.
            }
        },
    };
}
