/**
 * The installable apps the web page can offer: the Windows installer and the Android APK, both
 * published as GitHub releases (`desktop-v<version>` and `android-v<version>`). There is no iOS,
 * macOS or Linux app, so those get no offer.
 */
export type InstallTarget = "windows" | "android";

export type AppDownload = {
    version: string;
    url: string;
    /** Bytes; 0 when GitHub does not say. */
    size: number;
};

export const RELEASES_PAGE_URL = "https://github.com/GustavoRFS/P2P-Cast/releases";
const RELEASES_API_URL = "https://api.github.com/repos/GustavoRFS/P2P-Cast/releases?per_page=30";

const RELEASE_ASSETS: Record<InstallTarget, { tagPrefix: string; assetSuffix: string }> = {
    windows: { tagPrefix: "desktop-v", assetSuffix: "-setup.exe" },
    android: { tagPrefix: "android-v", assetSuffix: ".apk" },
};

export function detectInstallTarget(userAgent: string, maxTouchPoints = 0): InstallTarget | null {
    if (/iPhone|iPad|iPod/i.test(userAgent)) return null;
    // iPadOS asks for desktop pages and reports itself as a Mac; only the touch screen gives it away.
    if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return null;
    if (/Android/i.test(userAgent)) return "android";
    if (/Windows NT/i.test(userAgent)) return "windows";
    return null;
}

/** The newest published release for the target that carries its installer, or null. */
export async function findAppDownload(
    target: InstallTarget,
    fetchImpl: typeof fetch = fetch,
): Promise<AppDownload | null> {
    const response = await fetchImpl(RELEASES_API_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) return null;
    const { tagPrefix, assetSuffix } = RELEASE_ASSETS[target];
    // GitHub lists releases newest first.
    for (const release of releases) {
        if (!release || release.draft || release.prerelease) continue;
        if (typeof release.tag_name !== "string" || !release.tag_name.startsWith(tagPrefix)) continue;
        const assets: unknown[] = Array.isArray(release.assets) ? release.assets : [];
        const asset = assets.find((candidate): candidate is { name: string; browser_download_url: string; size?: unknown } =>
            typeof candidate === "object" && candidate !== null
            && typeof (candidate as { name?: unknown }).name === "string"
            && (candidate as { name: string }).name.endsWith(assetSuffix)
            && typeof (candidate as { browser_download_url?: unknown }).browser_download_url === "string",
        );
        if (asset) {
            return {
                version: release.tag_name.slice(tagPrefix.length),
                url: asset.browser_download_url,
                size: typeof asset.size === "number" ? asset.size : 0,
            };
        }
    }
    return null;
}

export function formatDownloadSize(bytes: number): string | null {
    if (bytes <= 0) return null;
    return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}
