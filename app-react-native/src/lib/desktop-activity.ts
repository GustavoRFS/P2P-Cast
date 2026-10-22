// How many watch screens are mounted: one can sit under another in the navigation stack.
let watchers = 0;

function report(): void {
    const desktop = typeof window !== "undefined" ? window.p2pcastDesktop : undefined;
    void desktop?.setWatching?.(watchers > 0).catch(() => undefined);
}

/**
 * Tells the desktop app a live is on screen, so its silent updates wait. Returns the function that
 * says it is gone (safe to call twice). A no-op on the web and Android.
 */
export function startWatching(): () => void {
    watchers += 1;
    report();
    let done = false;
    return () => {
        if (done) return;
        done = true;
        watchers -= 1;
        report();
    };
}
