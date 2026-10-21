// Builds the Android APK, signs it with our release key and publishes it as the GitHub release
// android-v<version>, which the web page's download modal offers to Android visitors.
//
//   npm run release:android -- --notes "O que mudou"
//   npm run release:android -- --draft
//   npm run release:android -- --skip-build      reuse android/app/build/outputs/apk/release
//   npm run release:android -- --eas             build on EAS instead (uses the monthly quota)
//
// Bump "version" and "android.versionCode" in app.json first: Android only installs an APK over
// the current one when its versionCode is higher and it is signed with the same key. The key is
// ~/.android/p2pcast-release.jks, passwords in ~/.android/p2pcast-release.properties (EAS reads the
// same through the git-ignored credentials.json; never commit either, the repository is public).
// Losing the key means a reinstall for everyone.
//
// Local builds on Windows need a CMake whose ninja handles long paths: the SDK's ninja 1.10 cannot
// create the 260+ character paths of React Native's C++ codegen. P2PCAST_CMAKE_DIR (default
// ~/.android/cmake-3.22.1-ninja-1.13.2: the SDK's CMake 3.22.1 with ninja 1.13) goes into
// android/local.properties as cmake.dir. Windows long paths must be enabled.
//
// The release is never marked "latest": that one must stay the desktop release, whose latest.json
// the desktop updater reads. JS-only changes go out through EAS Update instead (npm run update:android).
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REPO = "GustavoRFS/P2P-Cast";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};

function fail(message) {
    console.error(`release:android: ${message}`);
    process.exit(1);
}

function run(command, commandArgs, options = {}) {
    return execFileSync(command, commandArgs, { encoding: "utf8", cwd: root, ...options }).trim();
}

// npx and gradlew are .cmd/.bat files on Windows, so they need a shell; the commands are fixed.
function step(command, options = {}) {
    const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true, ...options });
    if (result.status !== 0) fail(`failed: ${command}`);
}

function readProperties(path) {
    return Object.fromEntries(
        readFileSync(path, "utf8")
            .split(/\r?\n/)
            .filter(line => line.includes("="))
            .map(line => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
    );
}

const { expo } = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
const version = expo.version;
const tag = `android-v${version}`;
const notes = option("--notes") ?? `P2P-Cast para Android ${version}`;

if (!flag("--allow-dirty") && run("git", ["status", "--porcelain", "--untracked-files=no"])) {
    fail("there are uncommitted changes (commit them, or pass --allow-dirty)");
}
const commit = run("git", ["rev-parse", "HEAD"]);
if (!run("git", ["branch", "-r", "--contains", commit])) fail("push this commit before releasing it");
if (spawnSync("gh", ["release", "view", tag, "--repo", REPO], { stdio: "ignore" }).status === 0) {
    fail(`${tag} already exists; bump version and android.versionCode in app.json`);
}

const propertiesPath = process.env.P2PCAST_ANDROID_KEYSTORE_PROPERTIES
    ?? join(homedir(), ".android", "p2pcast-release.properties");
if (!existsSync(propertiesPath)) fail(`no signing key properties at ${propertiesPath}`);
const keystore = readProperties(propertiesPath);
for (const key of ["storeFile", "keyAlias", "storePassword", "keyPassword"]) {
    if (!keystore[key]) fail(`${propertiesPath} is missing ${key}`);
}

const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const buildTools = join(sdk, "build-tools");
const toolsVersion = existsSync(buildTools) ? readdirSync(buildTools).sort().at(-1) : undefined;
if (!toolsVersion) fail(`no Android build-tools in ${buildTools}`);
const apksigner = join(buildTools, toolsVersion, process.platform === "win32" ? "apksigner.bat" : "apksigner");

const stageDir = join(root, "build", "android-release");
mkdirSync(stageDir, { recursive: true });
const assetName = `P2P-Cast-${version}.apk`;
const apkPath = join(stageDir, assetName);

if (flag("--eas")) {
    if (!existsSync(join(root, "credentials.json"))) fail("credentials.json is missing (keystore path and passwords for EAS)");
    const build = spawnSync(
        "npx -y eas-cli@latest build --platform android --profile production --non-interactive --wait --json",
        { cwd: root, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
    );
    if (build.status !== 0) fail("the EAS build failed (see its log on expo.dev)");
    const builds = JSON.parse(build.stdout.slice(build.stdout.indexOf("[")));
    const apkUrl = builds[0]?.artifacts?.applicationArchiveUrl ?? builds[0]?.artifacts?.buildUrl;
    if (!apkUrl) fail("the EAS build finished without an APK");
    const download = await fetch(apkUrl);
    if (!download.ok || !download.body) fail(`could not download the APK (HTTP ${download.status})`);
    await pipeline(Readable.fromWeb(download.body), createWriteStream(apkPath));
} else {
    const androidDir = join(root, "android");
    if (!flag("--skip-build")) {
        // --clean also drops android/app/build, so the fingerprint below is computed from scratch.
        step("npx expo prebuild --platform android --clean --no-install");
        const cmakeDir = process.env.P2PCAST_CMAKE_DIR ?? join(homedir(), ".android", "cmake-3.22.1-ninja-1.13.2");
        if (process.platform === "win32") {
            if (!existsSync(join(cmakeDir, "bin", "ninja.exe"))) fail(`no long-path CMake at ${cmakeDir} (see the header of this script)`);
            writeFileSync(join(androidDir, "local.properties"), `cmake.dir=${cmakeDir.replace(/\\/g, "/")}\n`);
        }
        // arm64-v8a covers current phones and keeps the build within this machine's memory.
        step(`${process.platform === "win32" ? "gradlew.bat" : "./gradlew"} assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon`, { cwd: androidDir });
    }
    const outputDir = join(androidDir, "app", "build", "outputs", "apk", "release");
    const built = existsSync(outputDir) ? readdirSync(outputDir).find(name => name.endsWith(".apk")) : undefined;
    if (!built) fail(`no APK in ${outputDir}`);
    const unsigned = join(stageDir, `unsigned-${built}`);
    copyFileSync(join(outputDir, built), unsigned);

    // Gradle can keep a stale fingerprint (its inputs miss package.json scripts and .gitignore);
    // then `eas update` would publish for a runtime this APK does not have.
    // Windows' own tar (bsdtar) reads zip files; Git Bash's GNU tar does not.
    const embedded = process.platform === "win32"
        ? run(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xOf", unsigned, "assets/fingerprint"])
        : run("unzip", ["-p", unsigned, "assets/fingerprint"]);
    const fingerprint = JSON.parse(spawnSync("npx expo-updates fingerprint:generate --platform android",
        { cwd: root, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout).hash;
    if (embedded !== fingerprint) {
        fail(`the APK's runtime fingerprint ${embedded} is not the project's ${fingerprint}; rebuild without --skip-build`);
    }

    // The Gradle release build is signed with the debug key; re-sign it with the release key.
    const env = { ...process.env, P2PCAST_KS_PASS: keystore.storePassword, P2PCAST_KEY_PASS: keystore.keyPassword };
    step(
        `"${apksigner}" sign --ks "${keystore.storeFile}" --ks-key-alias ${keystore.keyAlias} `
            + `--ks-pass env:P2PCAST_KS_PASS --key-pass env:P2PCAST_KEY_PASS --out "${apkPath}" "${unsigned}"`,
        { env },
    );
}

// Make sure it carries our release certificate before anyone installs it.
const verify = spawnSync(`"${apksigner}" verify --print-certs "${apkPath}"`, { shell: true, encoding: "utf8" });
if (verify.status !== 0) fail(`the APK signature does not verify:\n${verify.stderr}`);
console.log(verify.stdout.split(/\r?\n/).filter(line => /SHA-256/.test(line)).join("\n"));

const release = spawnSync("gh", [
    "release", "create", tag, apkPath,
    "--repo", REPO,
    "--target", commit,
    "--title", `P2P-Cast para Android ${version}`,
    "--notes", notes,
    "--latest=false",
    ...(flag("--draft") ? ["--draft"] : []),
], { cwd: root, stdio: "inherit" });
if (release.status !== 0) fail("could not create the GitHub release");
console.log(`release:android: ${tag} ${flag("--draft") ? "created as a draft" : "published"}`);
