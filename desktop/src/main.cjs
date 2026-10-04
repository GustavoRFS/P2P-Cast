const { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, safeStorage, shell, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");

protocol.registerSchemesAsPrivileged([{
    scheme: "p2pcast-app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

const APP_ORIGIN = "p2pcast-app://desktop";
const AUTH_CODE = /^[A-Za-z0-9_-]{43}$/;
const helperProcesses = new Map();
let mainWindow = null;
let selectedSourceId = null;
let pendingAuthCode = null;

function readConfig() {
    let fileConfig = {};
    const configPaths = [
        process.env.P2PCAST_CONFIG_PATH,
        app.isPackaged
            ? path.join(process.resourcesPath, "resources", "config.json")
            : path.resolve(__dirname, "../config.json"),
        path.join(app.getPath("userData"), "config.json"),
    ].filter(Boolean);
    for (const filePath of configPaths) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(filePath, "utf8"));
            break;
        } catch {
            // Try the next supported config location.
        }
    }

    const backendUrl = process.env.P2PCAST_BACKEND_URL || fileConfig.backendUrl || "http://localhost:3001";
    const parsed = new URL(backendUrl);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
        throw new Error("P2PCAST_BACKEND_URL must use HTTPS outside localhost");
    }
    const webUrl = process.env.P2PCAST_WEB_URL || fileConfig.webUrl || process.env.P2PCAST_RENDERER_URL || "http://localhost:5173";
    const web = new URL(webUrl);
    if (web.protocol !== "https:" && !(web.protocol === "http:" && ["localhost", "127.0.0.1"].includes(web.hostname))) {
        throw new Error("P2PCAST_WEB_URL must use HTTPS outside localhost");
    }
    return {
        backendUrl: parsed.origin,
        webUrl: web.origin,
        appOrigin: APP_ORIGIN,
        isolatedAudioAvailable: process.platform === "win32" && fs.existsSync(audioHelperPath()),
    };
}

function audioHelperPath() {
    return app.isPackaged
        ? path.join(process.resourcesPath, "resources", "p2pcast-process-audio.exe")
        : path.resolve(__dirname, "../resources/p2pcast-process-audio.exe");
}

function trustedRendererUrl(raw) {
    try {
        const url = new URL(raw);
        return url.protocol === "p2pcast-app:" && url.host === "desktop"
            || (process.env.P2PCAST_RENDERER_URL && url.origin === new URL(process.env.P2PCAST_RENDERER_URL).origin);
    } catch {
        return false;
    }
}

function assertMainFrame(event) {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error("Untrusted IPC sender");
    }
}

function trustedCsp() {
    const apiUrl = new URL(readConfig().backendUrl);
    const httpOrigin = apiUrl.origin;
    const socketOrigin = `${apiUrl.protocol === "https:" ? "wss:" : "ws:"}//${apiUrl.host}`;
    return [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "media-src 'self' blob:",
        `connect-src 'self' https://0.peerjs.com wss://0.peerjs.com:443 ${httpOrigin} ${socketOrigin}`,
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
    ].join("; ");
}

function resolvePackagedResource(requestUrl) {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== "p2pcast-app:" || parsed.host !== "desktop") return null;

    const rendererRoot = path.resolve(process.resourcesPath, "web-dist");
    const requestedPath = decodeURIComponent(parsed.pathname === "/" ? "/index.html" : parsed.pathname);
    let filePath = path.resolve(rendererRoot, `.${requestedPath}`);
    if (!filePath.startsWith(`${rendererRoot}${path.sep}`) && filePath !== path.join(rendererRoot, "index.html")) return null;
    if (!path.extname(filePath)) filePath = path.join(rendererRoot, "index.html");
    return filePath;
}

async function installAppProtocol() {
    await protocol.handle("p2pcast-app", async request => {
        const filePath = resolvePackagedResource(request.url);
        if (!filePath) return new Response("Not found", { status: 404 });
        try {
            const response = await net.fetch(pathToFileURL(filePath).toString());
            const headers = new Headers(response.headers);
            headers.set("Content-Security-Policy", trustedCsp());
            headers.set("X-Content-Type-Options", "nosniff");
            headers.set("Referrer-Policy", "no-referrer");
            return new Response(response.body, { status: response.status, headers });
        } catch {
            return new Response("Not found", { status: 404 });
        }
    });
}

function sendAuthCode(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "p2pcast:" || url.hostname !== "auth" || url.pathname !== "/callback") return;
        const code = url.searchParams.get("code");
        if (!code || !AUTH_CODE.test(code)) return;
        pendingAuthCode = code;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("desktop:auth:callback", code);
            pendingAuthCode = null;
        }
    } catch {
        // Ignore malformed protocol arguments.
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 780,
        minHeight: 620,
        backgroundColor: "#07111f",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://discord.com/oauth2/authorize")) void shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!trustedRendererUrl(url)) event.preventDefault();
    });

    const devUrl = process.env.P2PCAST_RENDERER_URL;
    if (devUrl) {
        void mainWindow.loadURL(devUrl);
    } else {
        void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
    }

    mainWindow.webContents.once("did-finish-load", () => {
        if (pendingAuthCode) {
            mainWindow?.webContents.send("desktop:auth:callback", pendingAuthCode);
            pendingAuthCode = null;
        }
    });
    mainWindow.on("closed", () => {
        selectedSourceId = null;
        mainWindow = null;
        stopAllHelpers();
    });
}

function backendUrlFor(pathname) {
    return new URL(pathname, readConfig().backendUrl).toString();
}

function sessionPath() {
    return path.join(app.getPath("userData"), "discord-session.bin");
}

function loginVerifierPath() {
    return path.join(app.getPath("userData"), "discord-login.bin");
}

function canUseSecureStorage() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false;
    return true;
}

function stopAllHelpers() {
    for (const capture of helperProcesses.values()) {
        capture.stopping = true;
        capture.child.kill();
    }
    helperProcesses.clear();
}

function sourceWindowHandle(sourceId) {
    const match = /^window:([^:]+):/.exec(sourceId);
    if (!match || !/^(?:0x)?[0-9a-f]+$/i.test(match[1])) return null;
    try {
        const encodedHandle = match[1];
        const value = /^0x/i.test(encodedHandle)
            ? BigInt(encodedHandle)
            : /^\d+$/.test(encodedHandle)
                ? BigInt(encodedHandle)
                : BigInt(`0x${encodedHandle}`);
        return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? value.toString(10) : null;
    } catch {
        return null;
    }
}

function sendAudioBytes(capture, bytes) {
    if (!bytes.length || !mainWindow || mainWindow.isDestroyed()) return;
    const exactBytes = Uint8Array.from(bytes);
    mainWindow.webContents.send("desktop:audio:data", {
        captureId: capture.captureId,
        chunk: exactBytes.buffer,
    });
}

function handleAudioData(capture, data) {
    const bytes = Buffer.concat([capture.remainder, Buffer.from(data)]);
    const alignedLength = bytes.length - (bytes.length % 8);
    capture.remainder = bytes.subarray(alignedLength);
    if (!alignedLength) return;

    const aligned = bytes.subarray(0, alignedLength);
    if (capture.resumed) sendAudioBytes(capture, aligned);
    else capture.pendingChunks.push(Buffer.from(aligned));
}

function startAudioHelper(sourceId) {
    if (process.platform !== "win32" || !fs.existsSync(audioHelperPath())) {
        return Promise.reject(new Error("Isolated application audio is not installed on this platform"));
    }
    const handle = sourceWindowHandle(sourceId);
    if (!handle) return Promise.reject(new Error("Could not resolve the selected window handle"));

    const captureId = randomUUID();
    const child = spawn(audioHelperPath(), [handle], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const capture = {
        captureId,
        child,
        ready: false,
        resumed: false,
        formatBuffer: Buffer.alloc(0),
        pendingChunks: [],
        remainder: Buffer.alloc(0),
        stderr: "",
        startupTimer: null,
        stopping: false,
        errorMessage: null,
        errorSent: false,
    };
    helperProcesses.set(captureId, capture);

    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = error => {
            if (!capture.ready) {
                if (settled) return;
                settled = true;
                clearTimeout(capture.startupTimer);
                helperProcesses.delete(captureId);
                child.kill();
                reject(error);
            } else if (!capture.stopping && !capture.errorSent) {
                capture.errorMessage = error.message;
                if (capture.resumed && mainWindow && !mainWindow.isDestroyed()) {
                    capture.errorSent = true;
                    mainWindow.webContents.send("desktop:audio:error", { captureId, message: error.message });
                }
            }
        };

        capture.startupTimer = setTimeout(() => fail(new Error("WASAPI audio capture did not start in time")), 5_000);
        child.stderr.on("data", value => {
            capture.stderr = `${capture.stderr}${value.toString("utf8")}`.slice(-2048);
        });
        child.stdout.on("data", value => {
            if (capture.ready) {
                handleAudioData(capture, value);
                return;
            }

            capture.formatBuffer = Buffer.concat([capture.formatBuffer, value]);
            const newline = capture.formatBuffer.indexOf(10);
            if (newline < 0) {
                if (capture.formatBuffer.length > 512) fail(new Error("Invalid WASAPI audio header"));
                return;
            }

            try {
                const format = JSON.parse(capture.formatBuffer.subarray(0, newline).toString("utf8"));
                if (format.sampleRate !== 48_000 || format.channels !== 2 || format.format !== "f32le") {
                    throw new Error("The WASAPI helper returned an unsupported audio format");
                }
                capture.ready = true;
                settled = true;
                clearTimeout(capture.startupTimer);
                child.stdout.pause();
                handleAudioData(capture, capture.formatBuffer.subarray(newline + 1));
                capture.formatBuffer = Buffer.alloc(0);
                resolve({ captureId, format });
            } catch (error) {
                fail(error);
            }
        });
        child.once("error", error => fail(new Error(`Could not start the WASAPI helper: ${error.message}`)));
        child.once("close", code => {
            if (!capture.ready) {
                helperProcesses.delete(captureId);
                fail(new Error(capture.stderr.trim() || `WASAPI audio helper exited with code ${code ?? "unknown"}`));
            } else if (!capture.stopping && !capture.errorSent) {
                capture.errorMessage = capture.stderr.trim() || `WASAPI audio helper exited with code ${code ?? "unknown"}`;
                if (capture.resumed && mainWindow && !mainWindow.isDestroyed()) {
                    capture.errorSent = true;
                    mainWindow.webContents.send("desktop:audio:error", { captureId, message: capture.errorMessage });
                }
            }
        });
    });
}

function registerIpc() {
    ipcMain.handle("desktop:config", event => {
        assertMainFrame(event);
        return readConfig();
    });

    ipcMain.handle("desktop:capture:list", async event => {
        assertMainFrame(event);
        const sources = await desktopCapturer.getSources({
            types: ["window"],
            thumbnailSize: { width: 320, height: 180 },
            fetchWindowIcons: true,
        });
        return sources.map(source => ({
            id: source.id,
            name: source.name.trim() || "Janela sem título",
            thumbnailDataUrl: source.thumbnail.toDataURL(),
        }));
    });

    ipcMain.handle("desktop:capture:select", event, sourceId => {
        assertMainFrame(event);
        if (typeof sourceId !== "string" || sourceId.length > 256 || !sourceId.startsWith("window:")) {
            throw new TypeError("Invalid desktop window id");
        }
        selectedSourceId = sourceId;
    });

    ipcMain.handle("desktop:auth:start", async (event, challenge) => {
        assertMainFrame(event);
        if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new TypeError("Invalid login challenge");
        const url = new URL(backendUrlFor("/auth/discord"));
        url.searchParams.set("code_challenge", challenge);
        await shell.openExternal(url.toString());
    });

    ipcMain.handle("desktop:auth:load", event => {
        assertMainFrame(event);
        if (!canUseSecureStorage()) return null;
        try {
            const value = safeStorage.decryptString(fs.readFileSync(sessionPath()));
            const sessionData = JSON.parse(value);
            if (typeof sessionData?.token !== "string" || typeof sessionData?.user?.id !== "string"
                || typeof sessionData?.user?.username !== "string") return null;
            return {
                token: sessionData.token,
                user: {
                    id: sessionData.user.id,
                    username: sessionData.user.username,
                    avatar: typeof sessionData.user.avatar === "string" ? sessionData.user.avatar : null,
                },
            };
        } catch {
            return null;
        }
    });

    ipcMain.handle("desktop:auth:save", (event, sessionData) => {
        assertMainFrame(event);
        if (!canUseSecureStorage()) throw new Error("Secure credential storage is not available on this system");
        if (typeof sessionData?.token !== "string" || sessionData.token.length > 8192
            || typeof sessionData?.user?.id !== "string" || typeof sessionData?.user?.username !== "string") {
            throw new TypeError("Invalid account session");
        }
        fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
        const encrypted = safeStorage.encryptString(JSON.stringify(sessionData));
        fs.writeFileSync(sessionPath(), encrypted, { mode: 0o600 });
    });

    ipcMain.handle("desktop:auth:clear", event => {
        assertMainFrame(event);
        try {
            fs.unlinkSync(sessionPath());
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    });

    ipcMain.handle("desktop:auth:verifier:get", event => {
        assertMainFrame(event);
        if (!canUseSecureStorage()) return null;
        try {
            const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(loginVerifierPath())));
            if (typeof stored?.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(stored.verifier)
                || typeof stored.savedAt !== "number" || Date.now() - stored.savedAt > 10 * 60_000) return null;
            return stored.verifier;
        } catch {
            return null;
        }
    });

    ipcMain.handle("desktop:auth:verifier:save", (event, verifier) => {
        assertMainFrame(event);
        if (!canUseSecureStorage()) throw new Error("Secure credential storage is not available on this system");
        if (typeof verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) throw new TypeError("Invalid login verifier");
        fs.mkdirSync(path.dirname(loginVerifierPath()), { recursive: true });
        const encrypted = safeStorage.encryptString(JSON.stringify({ verifier, savedAt: Date.now() }));
        fs.writeFileSync(loginVerifierPath(), encrypted, { mode: 0o600 });
    });

    ipcMain.handle("desktop:auth:verifier:clear", event => {
        assertMainFrame(event);
        try {
            fs.unlinkSync(loginVerifierPath());
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    });

    ipcMain.handle("desktop:audio:start", (event, sourceId) => {
        assertMainFrame(event);
        if (typeof sourceId !== "string" || sourceId.length > 256 || !sourceId.startsWith("window:")) {
            throw new TypeError("Invalid desktop window id");
        }
        return startAudioHelper(sourceId);
    });
    ipcMain.handle("desktop:audio:resume", (event, captureId) => {
        assertMainFrame(event);
        if (typeof captureId !== "string") return;
        const capture = helperProcesses.get(captureId);
        if (!capture || capture.resumed) return;
        capture.resumed = true;
        if (capture.errorMessage) {
            if (mainWindow && !mainWindow.isDestroyed() && !capture.errorSent) {
                capture.errorSent = true;
                mainWindow.webContents.send("desktop:audio:error", { captureId, message: capture.errorMessage });
            }
            return;
        }
        for (const chunk of capture.pendingChunks) sendAudioBytes(capture, chunk);
        capture.pendingChunks = [];
        capture.child.stdout.resume();
    });
    ipcMain.handle("desktop:audio:stop", (event, captureId) => {
        assertMainFrame(event);
        if (typeof captureId !== "string") return;
        const capture = helperProcesses.get(captureId);
        if (!capture) return;
        capture.stopping = true;
        helperProcesses.delete(captureId);
        capture.child.kill();
    });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
    app.quit();
} else {
    app.on("open-url", (event, url) => {
        event.preventDefault();
        sendAuthCode(url);
    });

    app.on("second-instance", (_event, argv) => {
        const deepLink = argv.find(argument => argument.startsWith("p2pcast://"));
        if (deepLink) sendAuthCode(deepLink);
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    if (process.defaultApp && process.argv[1]) {
        app.setAsDefaultProtocolClient("p2pcast", process.execPath, [path.resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient("p2pcast");
    }

    app.whenReady().then(async () => {
        await installAppProtocol();
        registerIpc();
        session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
            const wantedId = selectedSourceId;
            selectedSourceId = null;
            if (!wantedId) {
                callback({});
                return;
            }
            try {
                const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
                const selected = sources.find(source => source.id === wantedId);
                callback(selected ? { video: selected } : {});
            } catch {
                callback({});
            }
        });
        createWindow();
        const coldStartLink = process.argv.find(argument => argument.startsWith("p2pcast://"));
        if (coldStartLink) sendAuthCode(coldStartLink);
    });

    app.on("before-quit", stopAllHelpers);
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
}
