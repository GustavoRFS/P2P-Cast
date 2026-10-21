// Publishes the web export to Vercel (project vencord-video, https://live.ligmacharl.es) as a
// prebuilt static deployment: production has always come from the CLI, and the project's Git builds
// fail (they expect a Vite app at the repository root), so this does not depend on its build settings.
//
//   npm run deploy:web            production
//   npm run deploy:web -- --preview
//
// Needs `npx vercel login` once. Roll back with `npx vercel rollback` or by promoting an older
// deployment in the Vercel dashboard.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ORG_ID = "team_50frZTjBfSUHmyDkBa9zI9bp";
const PROJECT_ID = "prj_0Yg3XVdwiBYk2auMltfmIkw7neak";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const production = !args.includes("--preview");

function fail(message) {
    console.error(`deploy:web: ${message}`);
    process.exit(1);
}

// npx is a .cmd on Windows, so this needs a shell; the commands are fixed strings.
function step(command, options = {}) {
    const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true, ...options });
    if (result.status !== 0) fail(`failed: ${command}`);
}

if (production && !args.includes("--allow-dirty")
    && execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim()) {
    fail("there are uncommitted changes (commit them, or pass --allow-dirty)");
}

step("npx expo export --platform web");

const stage = join(root, "build", "vercel");
rmSync(stage, { recursive: true, force: true });
const output = join(stage, ".vercel", "output");
mkdirSync(output, { recursive: true });
writeFileSync(join(stage, ".vercel", "project.json"), JSON.stringify({ orgId: ORG_ID, projectId: PROJECT_ID }));
cpSync(join(root, "dist"), join(output, "static"), { recursive: true });
writeFileSync(join(output, "config.json"), `${JSON.stringify({
    version: 3,
    routes: [
        // The old site served the Compose app's APK here; the home page now offers the current one.
        { src: "/downloads/p2pcast\\.apk", status: 302, headers: { Location: "/" } },
        // Bundles are content-hashed, so they never change under the same name.
        { src: "/_expo/static/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
        { handle: "filesystem" },
        // Single-page app: every other path (/watch/<id>, /broadcast) is resolved by Expo Router.
        { src: "/(.*)", dest: "/index.html" },
    ],
}, null, 2)}\n`);

step(`npx -y vercel@latest deploy --prebuilt --yes${production ? " --prod" : ""}`, { cwd: stage });
