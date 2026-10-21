// Builds the Android APK on EAS Build (production profile, signed with our own release key) and
// publishes it as the GitHub release android-v<version>, which the web page's download modal
// offers to Android visitors.
//
//   npm run release:android -- --notes "O que mudou"
//   npm run release:android -- --draft
//
// Bump "version" and "android.versionCode" in app.json first: Android only installs an APK over
// the current one when its versionCode is higher and it is signed with the same key. The key is
// ~/.android/p2pcast-release.jks; EAS reads it through the git-ignored credentials.json (never
// commit that file: the repository is public). Losing the key means a reinstall for everyone.
//
// Why EAS and not Gradle here: on Windows, the Android SDK's ninja cannot create the 260+ character
// paths React Native's C++ codegen produces, even from a short checkout path.
//
// The release is never marked "latest": that one must stay the desktop release, whose latest.json
// the desktop updater reads. JS-only changes go out through EAS Update instead (npm run update:android).
import { execFileSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
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
if (!existsSync(join(root, "credentials.json"))) {
    fail("credentials.json is missing (keystore path and passwords for EAS; see the README)");
}

// npx is a .cmd on Windows, so this needs a shell; the arguments are fixed strings.
const build = spawnSync(
    "npx -y eas-cli@latest build --platform android --profile production --non-interactive --wait --json",
    { cwd: root, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
);
if (build.status !== 0) fail("the EAS build failed (see its log on expo.dev)");
const jsonStart = build.stdout.indexOf("[");
const builds = JSON.parse(build.stdout.slice(jsonStart));
const apkUrl = builds[0]?.artifacts?.applicationArchiveUrl ?? builds[0]?.artifacts?.buildUrl;
if (!apkUrl) fail("the EAS build finished without an APK");

const stageDir = join(root, "build", "android-release");
mkdirSync(stageDir, { recursive: true });
const assetName = `P2P-Cast-${version}.apk`;
const apkPath = join(stageDir, assetName);
const download = await fetch(apkUrl);
if (!download.ok || !download.body) fail(`could not download the APK (HTTP ${download.status})`);
await pipeline(Readable.fromWeb(download.body), createWriteStream(apkPath));

// Make sure it carries our release certificate before anyone installs it.
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const buildTools = join(sdk, "build-tools");
const toolsVersion = existsSync(buildTools) ? readdirSync(buildTools).sort().at(-1) : undefined;
if (toolsVersion) {
    const apksigner = join(buildTools, toolsVersion, process.platform === "win32" ? "apksigner.bat" : "apksigner");
    const verify = spawnSync(`"${apksigner}" verify --print-certs "${apkPath}"`, { shell: true, encoding: "utf8" });
    if (verify.status !== 0) fail(`the APK signature does not verify:\n${verify.stderr}`);
    console.log(verify.stdout.split(/\r?\n/).filter(line => /SHA-256/.test(line)).join("\n"));
} else {
    console.warn("release:android: no Android build-tools found; the signature was not checked");
}

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
