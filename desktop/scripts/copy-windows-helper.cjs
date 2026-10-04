const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const candidates = [
    path.join(desktopRoot, "native/windows/build/Release/p2pcast-process-audio.exe"),
    path.join(desktopRoot, "native/windows/build/p2pcast-process-audio.exe"),
];
const source = candidates.find(candidate => fs.existsSync(candidate));
if (!source) throw new Error("CMake did not produce p2pcast-process-audio.exe");
fs.copyFileSync(source, path.join(desktopRoot, "resources/p2pcast-process-audio.exe"));
