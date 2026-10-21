// Builds the signed Windows installer and publishes it as a GitHub release, with the latest.json
// feed the in-app updater reads (plugins.updater.endpoints in tauri.conf.json):
//   https://github.com/GustavoRFS/P2P-Cast/releases/latest/download/latest.json
//
//   npm run release -- --notes "O que mudou"      build, then publish desktop-v<version>
//   npm run release -- --draft                    publish as a draft (invisible to the updater)
//   npm run release -- --skip-build               reuse the installer already in target/release
//
// Bump "version" in src-tauri/tauri.conf.json first; installed apps only update to a higher one.
// Signing key: TAURI_SIGNING_PRIVATE_KEY (path or content), defaulting to
// ~/.tauri/p2p-cast-updater.key. Losing that key means installed apps can no longer update.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
    console.error(`release: ${message}`);
    process.exit(1);
}

function run(command, commandArgs, options = {}) {
    return execFileSync(command, commandArgs, { encoding: "utf8", cwd: root, ...options }).trim();
}

const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const tag = `desktop-v${version}`;
const notes = option("--notes") ?? `P2P-Cast ${version}`;

// The installer must match the tagged commit, and the tag must point at a commit GitHub has.
if (!flag("--allow-dirty") && run("git", ["status", "--porcelain", "--untracked-files=no"])) {
    fail("there are uncommitted changes (commit them, or pass --allow-dirty)");
}
const commit = run("git", ["rev-parse", "HEAD"]);
if (!run("git", ["branch", "-r", "--contains", commit])) fail("push this commit before releasing it");
if (spawnSync("gh", ["release", "view", tag, "--repo", REPO], { stdio: "ignore" }).status === 0) {
    fail(`${tag} already exists; bump the version in src-tauri/tauri.conf.json`);
}

const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    const keyPath = join(homedir(), ".tauri", "p2p-cast-updater.key");
    if (!existsSync(keyPath)) fail(`no signing key: set TAURI_SIGNING_PRIVATE_KEY or create ${keyPath}`);
    env.TAURI_SIGNING_PRIVATE_KEY = keyPath;
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";

if (!flag("--skip-build")) {
    const build = spawnSync("npm", ["run", "build:windows"], { cwd: root, env, stdio: "inherit", shell: true });
    if (build.status !== 0) fail("the build failed");
}

const bundleDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installer = existsSync(bundleDir)
    ? readdirSync(bundleDir).find(name => name.endsWith(`_${version}_x64-setup.exe`))
    : undefined;
if (!installer || !existsSync(join(bundleDir, `${installer}.sig`))) {
    fail(`no signed ${version} installer in ${bundleDir}`);
}

// Asset names without spaces, so their URLs stay readable.
const assetName = `P2P-Cast_${version}_x64-setup.exe`;
const stageDir = join(root, "src-tauri", "target", "release", "bundle", "github-release");
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
copyFileSync(join(bundleDir, installer), join(stageDir, assetName));
const feed = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
        "windows-x86_64": {
            signature: readFileSync(join(bundleDir, `${installer}.sig`), "utf8").trim(),
            url: `https://github.com/${REPO}/releases/download/${tag}/${assetName}`,
        },
    },
};
writeFileSync(join(stageDir, "latest.json"), `${JSON.stringify(feed, null, 2)}\n`);

// "latest" is what the feed URL resolves to, so a desktop release must always be marked latest.
const releaseArgs = [
    "release", "create", tag,
    join(stageDir, assetName), join(stageDir, "latest.json"),
    "--repo", REPO,
    "--target", commit,
    "--title", `P2P-Cast ${version}`,
    "--notes", notes,
    flag("--draft") ? "--draft" : "--latest",
];
const release = spawnSync("gh", releaseArgs, { cwd: root, stdio: "inherit" });
if (release.status !== 0) fail("could not create the GitHub release");
console.log(`release: ${tag} ${flag("--draft") ? "created as a draft" : "published"}`);
