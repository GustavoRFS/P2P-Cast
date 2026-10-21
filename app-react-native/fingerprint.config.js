// The runtime fingerprint decides which installed APKs an EAS update reaches, so it should change
// only with the native side. By default it also hashed every package.json script and .gitignore:
// adding a release/deploy helper script silently cut the published APK off from updates. Versions
// are skipped too, so APKs with the same native code share one runtime.
const { SourceSkips } = require("@expo/fingerprint");

/** @type {import("@expo/fingerprint").Config} */
module.exports = {
    sourceSkips:
        SourceSkips.PackageJsonScriptsAll
        | SourceSkips.GitIgnore
        | SourceSkips.EasJson
        | SourceSkips.ExpoConfigVersions,
};
