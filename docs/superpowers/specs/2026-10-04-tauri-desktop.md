# Tauri desktop version

## Goal

Add a Tauri desktop build beside Electron so both hosts use the existing P2P-Cast React application, Elysia backend, Discord login and PeerJS signaling protocol. This gives the project two desktop packages that can be measured on the same machine.

## Shared behavior

- Use the same `web` renderer, backend endpoints, Discord OAuth/PKCE flow, presence reporting and PeerJS broadcast/view protocol as Electron.
- Preserve browser-only broadcasting for people who do not sign in.
- Keep login tokens and the short-lived PKCE verifier in the operating system credential store.
- Register and handle the `p2pcast-tauri://auth/callback` deep link, separate from Electron's existing `p2pcast://` callback. Bind the selected host to the backend's OAuth state.
- Package the same web build in a separate Tauri host under `desktop-tauri/`.

## Capture behavior and comparison caveat

- Tauri uses `getDisplayMedia` with audio explicitly disabled. The operating system/WebView picker lets the broadcaster choose one window or app, and the app checks that the returned track identifies a window before sending it over the same PeerJS media path.
- Do not request or forward system audio. This prevents Discord, Spotify, and other unrelated system audio from entering a Tauri broadcast.
- The Tauri WebView API does not provide Electron's enumerable desktop window source IDs, so the app cannot safely bind the selected window to the existing per-process WASAPI helper. The Tauri build therefore does not offer isolated game audio. Electron remains the Windows build with per-application audio.
- The UI must show the system picker flow and state that Tauri captures video only. The comparison guide must state that stream performance is not fully apples-to-apples because Tauri omits audio capture.

## UI and host boundary

- Extend the existing desktop bridge contract with a host kind and a capture-picker mode, while keeping Electron's source list and selected-window behavior intact.
- Initialize a Tauri bridge only when running inside Tauri. It supplies config, OAuth opening, keyring-backed session/verifier commands, pending and subsequent deep-link callbacks, and the single system-picker source placeholder.
- In the shared home screen, replace the Electron source dropdown for the Tauri host with a clear “choose window when starting” explanation. Keep capture settings and the viewer protocol shared.
- Keep Tauri's frontend capabilities limited to the app window and required opener/deep-link APIs.

## Packaging and documentation

- Add an independently buildable `desktop-tauri/` Rust/Tauri v2 host and scripts that build the shared web renderer before running or packaging Tauri.
- Provide an example config and document platform prerequisites, launch/build commands, capture limitations, and how to compare installed bundle size and live CPU/memory on the same machine.
- Do not publish numeric size or performance claims without building/running both packages on the target operating system.

## Acceptance criteria

- The Tauri host launches the shared web app and can broadcast/view through the current protocol.
- Discord login and return deep link work through the same backend PKCE flow, with secrets stored in the OS credential manager.
- Tauri prompts for a single app/window through the system picker, accepts only a returned window track, and always requests `audio: false` for display capture.
- Tauri UI explains that app-only audio is unavailable; it does not imply that game audio is included.
- Electron behavior and the unrelated Android working changes remain untouched.
- Build and type-check commands are documented and attempted where the local environment supports them.
