/** Prefers the desktop bridge: the webview cannot write to the clipboard while unfocused. */
export async function writeClipboardText(text: string): Promise<void> {
    const bridge = typeof window !== "undefined" ? window.p2pcastDesktop : undefined;
    if (bridge?.copyShareLink) {
        await bridge.copyShareLink(text);
        return;
    }
    await navigator.clipboard.writeText(text);
}
