const { contextBridge, ipcRenderer } = require("electron");
const authCallbacks = new Set();
let pendingAuthCode = null;

function validSourceId(sourceId) {
    return typeof sourceId === "string" && sourceId.length > 0 && sourceId.length <= 256;
}

function subscribe(channel, callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

ipcRenderer.on("desktop:auth:callback", (_event, code) => {
    if (typeof code !== "string") return;
    pendingAuthCode = code;
    if (authCallbacks.size === 0) return;
    const listeners = [...authCallbacks];
    pendingAuthCode = null;
    for (const callback of listeners) callback(code);
});

contextBridge.exposeInMainWorld("p2pcastDesktop", Object.freeze({
    getWindowSources: () => ipcRenderer.invoke("desktop:capture:list"),
    selectWindow: sourceId => {
        if (!validSourceId(sourceId)) return Promise.reject(new TypeError("Invalid desktop window id"));
        return ipcRenderer.invoke("desktop:capture:select", sourceId);
    },
    getConfig: () => ipcRenderer.invoke("desktop:config"),
    loginWithDiscord: codeChallenge => {
        if (typeof codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
            return Promise.reject(new TypeError("Invalid login handoff challenge"));
        }
        return ipcRenderer.invoke("desktop:auth:start", codeChallenge);
    },
    getSavedSession: () => ipcRenderer.invoke("desktop:auth:load"),
    saveSession: session => ipcRenderer.invoke("desktop:auth:save", session),
    clearSession: () => ipcRenderer.invoke("desktop:auth:clear"),
    getLoginVerifier: () => ipcRenderer.invoke("desktop:auth:verifier:get"),
    saveLoginVerifier: verifier => ipcRenderer.invoke("desktop:auth:verifier:save", verifier),
    clearLoginVerifier: () => ipcRenderer.invoke("desktop:auth:verifier:clear"),
    onAuthCallback: callback => {
        authCallbacks.add(callback);
        if (pendingAuthCode) {
            const code = pendingAuthCode;
            pendingAuthCode = null;
            queueMicrotask(() => {
                if (authCallbacks.has(callback)) callback(code);
            });
        }
        return () => authCallbacks.delete(callback);
    },
    startApplicationAudio: sourceId => {
        if (!validSourceId(sourceId)) return Promise.reject(new TypeError("Invalid desktop window id"));
        return ipcRenderer.invoke("desktop:audio:start", sourceId);
    },
    resumeApplicationAudio: captureId => ipcRenderer.invoke("desktop:audio:resume", captureId),
    stopApplicationAudio: captureId => ipcRenderer.invoke("desktop:audio:stop", captureId),
    onApplicationAudioData: (captureId, callback) => {
        if (typeof captureId !== "string" || captureId.length > 80) return () => {};
        const listener = (_event, message) => {
            if (message?.captureId === captureId && message.chunk instanceof ArrayBuffer) callback(message.chunk);
        };
        ipcRenderer.on("desktop:audio:data", listener);
        return () => ipcRenderer.removeListener("desktop:audio:data", listener);
    },
    onApplicationAudioError: (captureId, callback) => {
        if (typeof captureId !== "string" || captureId.length > 80) return () => {};
        const listener = (_event, message) => {
            if (message?.captureId === captureId && typeof message.message === "string") callback(message.message);
        };
        ipcRenderer.on("desktop:audio:error", listener);
        return () => ipcRenderer.removeListener("desktop:audio:error", listener);
    },
}));
