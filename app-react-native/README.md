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

## Platform notes

- **Hermes**: shared code avoids `URLSearchParams.set`, `DOMException` and `crypto.randomUUID`
  outside desktop-only paths; `window.localStorage` comes from `expo-sqlite/localStorage`.
- **Presence on Android** sends `Origin: p2pcast-app://android`. Backends that set `APP_ORIGINS`
  must include it.
- **App Links**: `public/.well-known/assetlinks.json` still lists only the old app
  (`com.p2pcast.android`). Add `com.p2pcast.app` with its release certificate fingerprint once it
  is signed for release.
- **NativeWind** uses `darkMode: "class"`: inside the Tauri WebView2 a class toggles on `<html>`,
  which throws with the default media mode.
