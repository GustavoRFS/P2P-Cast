# P2P-Cast app

Universal client for P2P-Cast, built with Expo (SDK 58), Expo Router and NativeWind.
One codebase serves three targets:

- **Web** (`npm run export:web`): create a broadcast link from the browser and watch from a link.
- **Desktop**: the Tauri shell in `../desktop-tauri` loads the web export and exposes native
  capture, shortcuts, tray and clipboard through `window.p2pcastDesktop`.
- **Android**: a development build with a local Expo module that wraps the Kotlin screen/camera
  capture and WebRTC engine.

```sh
npm install
npm run web            # web dev server (also what `tauri dev` loads)
npm run export:web     # static export to dist/ (what `tauri build` bundles)
npx expo run:android   # Android development build
npm run typecheck
```
