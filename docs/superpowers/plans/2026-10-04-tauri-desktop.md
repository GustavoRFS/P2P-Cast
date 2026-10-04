# Tauri desktop implementation plan

> **For Codex:** execute this plan in order. Keep the existing Electron host and shared P2P protocol intact.

**Goal:** Add a Tauri v2 desktop host using the shared React frontend and the existing Elysia, Discord OAuth/PKCE, presence and PeerJS flows, with a system window picker and isolated system audio disabled.

**Architecture:** Add `desktop-tauri/` with a small Rust host, Tauri capabilities/configuration, secure OS credential storage and deep-link support. Adapt the existing `window.p2pcastDesktop` boundary so the React application can use either host. Add no parallel capture/signaling implementation: Electron keeps its native source list and process audio; Tauri uses one system-selected video stream with `audio: false`.

**Stack:** Tauri 2, Rust, existing React/Vite frontend, `@tauri-apps/api`, Tauri deep-link/opener/single-instance plugins, Rust keyring crate.

### Step 1: Define shared desktop host contract

- Add host kind, display source selection mode, audio capture mode and app origin to desktop config/types.
- Add Tauri initialization that exposes a bridge only in a Tauri webview, including config, external OAuth URL, secure session/verifier storage and auth callback delivery.
- Preserve Electron implementation behind its existing preload bridge.
- Rework the desktop window picker panel so Electron keeps its source list and Tauri directs users to choose one window in the native picker when they start streaming.

### Step 2: Add the Tauri Rust host

- Create the Tauri v2 app configuration, Rust command handlers, secure keyring access and deep-link/single-instance handling.
- Validate callback URL shape and OAuth challenge/verifier inputs at the host boundary.
- Restrict external link opening to the configured backend's Discord OAuth authorize URL and restrict frontend capabilities to the required commands/events.
- Bundle `web/dist`; keep dev mode pointed at the Vite server.

### Step 3: Connect Tauri capture and shared flow

- Have Tauri provide a single “system picker” source placeholder and no-op selection command.
- Use the existing shared capture function with video constraints and explicit `audio: false`; reject app-audio requests with the existing explanatory UI.
- Keep the PeerJS broadcaster/viewer flow and presence login logic shared.
- Add Tauri development/build/package scripts, example config, and root comparison documentation.

### Step 4: Verify the implementation

- Inspect the final diff and ensure only the Tauri feature and shared desktop bridge/UI are changed.
- Run frontend type-check/build and available Rust formatting/check/build commands; record missing platform dependencies if this Termux environment cannot build the native host.
- Do not claim bundle size or performance results unless both native packages are built and measured on the same desktop OS.
