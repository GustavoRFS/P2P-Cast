const STORAGE_KEY = "p2pcast.capture-failures.debug";
const MAX_ENTRIES = 5;

type CaptureFailureEntry = {
    at: string;
    stage: string;
    kind: string;
    name?: string;
    message: string;
    stack?: string;
};

function describe(stage: string, error: unknown): CaptureFailureEntry {
    const isError = error instanceof Error;
    return {
        at: new Date().toISOString(),
        stage,
        kind: isError ? error.constructor.name : typeof error,
        name: isError ? error.name : undefined,
        message: isError ? error.message : String(error),
        stack: isError ? error.stack?.slice(0, 800) : undefined,
    };
}

/** Temporary diagnostic sink: keeps the raw capture failures readable outside the app. */
export function recordCaptureFailure(stage: string, error: unknown): void {
    const entry = describe(stage, error);
    console.error(`[p2pcast] ${stage} failed:`, error);

    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = stored ? JSON.parse(stored) : [];
        const previous = Array.isArray(parsed) ? parsed : [];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...previous, entry].slice(-MAX_ENTRIES)));
    } catch {
        // Storage can be unavailable; the console log above is enough.
    }
}
