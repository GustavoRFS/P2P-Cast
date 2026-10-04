const { spawn } = require("node:child_process");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const webRoot = path.resolve(desktopRoot, "../web");
const rendererUrl = "http://127.0.0.1:5173";
const viteCli = path.join(webRoot, "node_modules", "vite", "bin", "vite.js");

const vite = spawn(process.execPath, [viteCli, "--host", "127.0.0.1"], {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
});

let electron = null;
let stopping = false;

function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    vite.kill();
    electron?.kill();
    process.exitCode = exitCode;
}

async function waitForVite() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (vite.exitCode !== null) throw new Error("Vite exited before it became ready");
        try {
            const response = await fetch(rendererUrl);
            if (response.ok) return;
        } catch {
            // Vite has not opened its local port yet.
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("Vite did not become ready at 127.0.0.1:5173");
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
vite.on("error", error => {
    console.error("Could not start Vite:", error.message);
    stop(1);
});

waitForVite().then(() => {
    const electronBinary = require("electron");
    electron = spawn(electronBinary, [desktopRoot], {
        stdio: "inherit",
        env: { ...process.env, P2PCAST_RENDERER_URL: rendererUrl },
    });
    electron.on("error", error => {
        console.error("Could not start Electron:", error.message);
        stop(1);
    });
    electron.on("exit", code => stop(code ?? 0));
}).catch(error => {
    console.error(error.message);
    stop(1);
});
