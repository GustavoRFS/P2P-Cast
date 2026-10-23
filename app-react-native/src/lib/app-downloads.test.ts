import { describe, expect, it } from "vitest";
import {
    detectInstallTarget,
    findAppDownload,
    formatDownloadSize,
} from "./app-downloads";

const UA = {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    android: "Mozilla/5.0 (Linux; Android 15; 23090RA98G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
    ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
};

function fakeFetch(body: unknown, ok = true): typeof fetch {
    return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

const RELEASES = [
    { tag_name: "desktop-v0.4.0", draft: true, prerelease: false, assets: [{ name: "P2P-Cast_0.4.0_x64-setup.exe", browser_download_url: "https://x/draft.exe", size: 1 }] },
    { tag_name: "android-v1.1.0", draft: false, prerelease: false, assets: [{ name: "P2P-Cast-1.1.0.apk", browser_download_url: "https://x/app-1.1.0.apk", size: 52428800 }] },
    { tag_name: "desktop-v0.3.0", draft: false, prerelease: false, assets: [
        { name: "latest.json", browser_download_url: "https://x/latest.json", size: 900 },
        { name: "P2P-Cast_0.3.0_x64-setup.exe", browser_download_url: "https://x/setup-0.3.0.exe", size: 34691350 },
    ] },
    { tag_name: "android-v1.0.0", draft: false, prerelease: false, assets: [{ name: "P2P-Cast-1.0.0.apk", browser_download_url: "https://x/app-1.0.0.apk", size: 1 }] },
];

describe("detectInstallTarget", () => {
    it("offers the APK on Android and the installer on Windows", () => {
        expect(detectInstallTarget(UA.android)).toBe("android");
        expect(detectInstallTarget(UA.windows)).toBe("windows");
    });

    it("offers nothing on iOS, iPadOS in desktop mode, or computers without an app", () => {
        expect(detectInstallTarget(UA.iphone)).toBeNull();
        expect(detectInstallTarget(UA.ipadDesktopMode, 5)).toBeNull();
        expect(detectInstallTarget(UA.ipadDesktopMode, 0)).toBeNull();
        expect(detectInstallTarget(UA.linux)).toBeNull();
    });
});

describe("findAppDownload", () => {
    it("picks the newest published release with the right installer", async () => {
        await expect(findAppDownload("windows", fakeFetch(RELEASES))).resolves.toEqual({
            version: "0.3.0",
            url: "https://x/setup-0.3.0.exe",
            size: 34691350,
        });
        await expect(findAppDownload("android", fakeFetch(RELEASES))).resolves.toEqual({
            version: "1.1.0",
            url: "https://x/app-1.1.0.apk",
            size: 52428800,
        });
    });

    it("returns null when GitHub fails or has nothing for the target", async () => {
        await expect(findAppDownload("windows", fakeFetch({ message: "rate limited" }, false))).resolves.toBeNull();
        await expect(findAppDownload("android", fakeFetch([RELEASES[2]]))).resolves.toBeNull();
        await expect(findAppDownload("windows", fakeFetch({ message: "not a list" }))).resolves.toBeNull();
    });
});

describe("formatDownloadSize", () => {
    it("rounds to megabytes and hides unknown sizes", () => {
        expect(formatDownloadSize(34691350)).toBe("33 MB");
        expect(formatDownloadSize(0)).toBeNull();
    });
});
