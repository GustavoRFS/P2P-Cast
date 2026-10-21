# P2P-Cast app

Universal client for P2P-Cast: Expo SDK 58, Expo Router and NativeWind (Tailwind 3). One set of
React Native components serves three targets.

| Target | What it does | Runs on |
|---|---|---|
| **Web** | Create a broadcast link (screen/camera from the browser) and watch from a link | `expo export --platform web` (static SPA) |
| **Desktop** | Global-shortcut screen broadcasts, tray, Discord drawer | the Tauri shell in `../desktop-tauri` loads the web export |
| **Android** | Screen/camera broadcasts and viewing through the Kotlin engine, Discord login, live notifications | development/release build with `modules/p2pcast-native` |

```sh
npm install
npm run web            # web dev server (also what `tauri dev` loads, on port 5173)
npm run export:web     # static export to dist/ (what `tauri build` bundles)
npm run android        # expo run:android, needs a device or emulator
npm run typecheck
npm test               # shared logic (src/lib)
```

## Layout

- `src/app/` — routes: `/` (home per platform), `/broadcast`, `/watch/[peerId]`. Old share links
  (`/?watch=<id>`) forward to the viewer route.
- `src/lib/` — platform-agnostic logic carried over from the Vite client, with its tests.
- `src/features/session/` — broadcaster and viewer sessions. `*.web.ts` use PeerJS in the browser
  and Tauri; the plain `.ts` files drive the Android native module. The broadcast lives in a root
  provider so it survives navigation and a desktop shortcut can start it from any screen.
- `src/features/account/` — Discord login (OAuth + PKCE through the backend) and presence, over an
  `AccountPlatform` adapter: the Tauri bridge on desktop, Expo modules on Android, none on the web.
- `src/features/desktop/` — shortcut profiles (each carries its own transmission settings).
- `src/platform/` — what differs per platform: desktop bridge bootstrap, clipboard, storage.
- `modules/p2pcast-native/` — local Expo module around the Kotlin engine from the original
  Compose app (`com.p2pcast.android.*`: capture, PeerJS signaling, WebRTC, foreground service).
  JS gets state as events and renders tracks with the `P2PCastVideoView` native view.

## Updates

- **Android (EAS Update)**: `expo-updates` with a `fingerprint` runtime version, so a JS update only
  reaches builds whose native side (including `modules/p2pcast-native`) matches. Builds from
  `eas.json` carry a channel (`preview`, `production`); `npm run update:android` publishes the JS
  bundle to `production`. The app checks at launch and when it returns to the foreground, and
  `UpdateBanner` offers a restart except during a broadcast. Native changes need a new build
  (`npm run build:android`).
- **Android APK releases**: `npm run release:android -- --notes "..."` prebuilds, runs the Gradle
  release build (arm64-v8a), checks that the APK's runtime fingerprint matches the project's (so EAS
  updates reach it), re-signs it with our key `~/.android/p2pcast-release.jks` (passwords in
  `~/.android/p2pcast-release.properties`) and publishes it as the GitHub release
  `android-v<version>`, never marked latest (that one is the desktop feed). Bump `version` and
  `android.versionCode` in app.json first, and back up the key: an APK signed with another one
  cannot install over the current app. On Windows the build needs a CMake whose ninja handles long
  paths (`~/.android/cmake-3.22.1-ninja-1.13.2`, see the script header): the SDK's ninja 1.10 fails
  on React Native's 260+ character C++ codegen paths. `--eas` builds on EAS instead, signing with
  the same key through a git-ignored `credentials.json` (never commit it, the repository is public).
- **Desktop**: the Tauri updater installs new versions of the whole app, web export included; see
  "Atualizações do desktop" in the root README.
- **Web download offer**: `InstallAppModal` suggests the Windows installer or the APK (from the
  newest `desktop-v*` / `android-v*` release) to web visitors; iOS/iPadOS and computers without an
  app get nothing, and "Agora não" snoozes it for 14 days.

## Platform notes

- **Hermes**: shared code avoids `URLSearchParams.set`, `DOMException` and `crypto.randomUUID`
  outside desktop-only paths; `window.localStorage` comes from `expo-sqlite/localStorage`.
- **Presence on Android** sends `Origin: p2pcast-app://android`. Backends that set `APP_ORIGINS`
  must include it.
- **App Links**: `public/.well-known/assetlinks.json` lists `com.p2pcast.app` with the release
  key's certificate (SHA-256 `4C:66:A5:…`) next to the old `com.p2pcast.android`. A new signing
  key needs a new entry there.
- **Web deploys**: `npm run deploy:web` exports the web build and publishes it to Vercel
  (`live.ligmacharl.es`) as a prebuilt static deployment with an SPA fallback. Production always
  came from the CLI; the project's Git builds fail because they expect a Vite app at the repo root.
- **NativeWind** uses `darkMode: "class"`: inside the Tauri WebView2 a class toggles on `<html>`,
  which throws with the default media mode.
