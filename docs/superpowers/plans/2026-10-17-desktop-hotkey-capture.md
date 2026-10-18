# Atalhos desktop e captura Tauri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local shortcut profiles to Electron and Tauri on Windows, with selectable Windows picker and direct native window/monitor capture in Tauri and process-isolated audio.

**Architecture:** React owns validated profile data and persistence. Each native host exposes source enumeration, shortcut registration, audio capture, and capture-start events through a narrow bridge; Tauri additionally owns Windows Graphics Capture and adapts its frames to the current WebRTC publishing flow.

**Tech Stack:** React, TypeScript, Electron 40, Tauri 2, Rust, Windows.Graphics.Capture, WASAPI Application Loopback, PeerJS.

**Spec:** [docs/superpowers/specs/2026-10-17-desktop-hotkey-capture-design.md](../specs/2026-10-17-desktop-hotkey-capture-design.md)

## Global Constraints

- First delivery targets Windows on both desktop hosts.
- Profiles are local to the desktop installation and continue to work while the app window is minimized/hidden but the app process remains running.
- Tauri exposes `seletor do Windows` and `captura direta` as per-profile options.
- The selector can choose a window or monitor; direct Tauri capture targets the registered HWND or HMONITOR.
- Profile audio is always enabled and comes from an explicitly selected process through WASAPI Application Loopback; global system audio is never used.
- Closing or stopping capture releases video, audio, shortcut event listeners, and native resources.
- No automated tests are added or run in this plan; verify with type/build commands and Windows runtime checks where available.

## Review Focus

- The selected window closes or its HWND changes between profile setup and hotkey activation; show a recoverable error without leaving partial capture active.
- Windows picker chooses a monitor while the profile has a separate process audio source; preserve the explicit audio source and explain the selection in UI.
- A profile's process exits while its monitor remains available; refuse to start rather than use global audio.
- Two profiles request the same shortcut or another app owns it; surface registration failure and keep other profiles registered.
- A Windows capture frame pool changes dimensions or loses its device; stop/recreate resources cleanly without leaking audio or leaving a stuck broadcast.

---

### Task 1: Validate Tauri's native video-to-WebRTC bridge

**Files:**
- Create/remove: temporary probe under `desktop-tauri/src-tauri/examples/` or an isolated ignored directory
- Read: `desktop-tauri/src-tauri/src/lib.rs`, `web/src/lib/desktop.ts`, `web/src/App.tsx`

**Interfaces:**
- Consumes: Windows Graphics Capture HWND/HMONITOR capture items and current `MediaStream`-based publisher.
- Produces: a documented bridge choice that yields a browser-compatible video track without sending full-rate raw frame arrays through Tauri events. Continue only if the same track can enter existing WebRTC publication without changing peer protocol.

- [ ] Inspect the supported WebView2 runtime interfaces available to this app for a native frame source (`MediaStreamTrackGenerator`/`VideoFrame`, canvas stream with a bounded native bridge, or an equivalent low-copy route).
- [ ] Build a throwaway Windows probe for one HWND and one HMONITOR; measure frame dimensions, delivered frame rate, and CPU/copy behavior at 720p/30 FPS.
- [ ] Feed the produced video track into a local `RTCPeerConnection` loopback and confirm frames arrive; remove all probe files after recording the decision.
- [ ] Stop the plan and return for design review if the bridge requires continuous full-frame Tauri IPC or a replacement of the existing PeerJS/WebRTC publishing path.

### Task 2: Add validated profile model and desktop bridge contracts

**Files:**
- Create: `web/src/lib/shortcut-profiles.ts`
- Modify: `web/src/desktop-bridge.d.ts`
- Modify: `web/src/lib/desktop.ts`

**Interfaces:**
- Produces `ShortcutProfile` with `{ id: string, name: string, videoTarget: { kind: "window" | "monitor", selector: string }, captureMethod: "windows-picker" | "direct", audioSourceSelector: string, shortcut: string, settings: CaptureSettings & { audio: true } }`.
- Electron accepts `captureMethod: "direct"` and maps the profile's exact target through its existing window-list source selection. Tauri accepts both methods.
- Host bridge adds `listCaptureTargets(): Promise<DesktopCaptureTarget[]>`, `resolveCaptureTarget(selector: string): Promise<DesktopCaptureTarget | null>`, `registerShortcutProfiles(profiles: ShortcutProfile[]): Promise<ShortcutRegistrationResult[]>`, and `onShortcutProfile(callback: (profileId: string) => void): () => void`.
- `DesktopCaptureTarget` is `{ id: string, selector: string, kind: "window" | "monitor", name: string, processId?: number, thumbnailDataUrl?: string }`; `id` is a runtime handle and `selector` is a stable executable/window identity or monitor device path saved in the profile.
- `captureDesktopWindow(target, settings, desktopConfig, options)` accepts a freshly resolved target and `options: { captureMethod: "windows-picker" | "direct", audioSourceId: string }`; `audioSourceId` is the current runtime ID resolved from `audioSourceSelector`.

- [ ] Define schema validation, versioned localStorage key `p2pcast.shortcut-profiles.v1`, load/save functions, and validation rules for target kind, capture method, shortcut syntax, settings and size bounds.
- [ ] Extend the shared desktop bridge declarations for capture targets, shortcut registration results, and activated profile IDs.
- [ ] Implement shared profile helpers and a storage-backed safe load that ignores malformed records without deleting valid profiles.
- [ ] Run `npm --prefix web run build` and confirm the new shared contract type-checks against current app code.

### Task 3: Enumerate targets and register global shortcuts in Electron

**Files:**
- Modify: `desktop/src/main.cjs`
- Modify: `desktop/src/preload.cjs`
- Modify: `desktop/src/renderer.d.ts`

**Interfaces:**
- Implements the bridge contracts from Task 2.
- Target enumeration returns current runtime IDs and stable selectors; profile activation resolves selectors again so old HWND/HMONITOR handles are never reused after app restart.
- Shortcut activation sends `desktop:shortcut:profile` with only a validated profile ID to the trusted main renderer.

- [ ] Add validated IPC endpoints for listing window/monitor capture targets and registering/unregistering profile shortcuts.
- [ ] Resolve saved executable/display selectors against fresh Electron capture sources immediately before capture; return unavailable when no unambiguous current target matches.
- [ ] Use Electron `globalShortcut` and return per-profile registration failures for duplicate, invalid, or OS-reserved combinations.
- [ ] Extend the preload with narrow typed methods and a removable subscription for shortcut activation.
- [ ] Keep all successful registrations synchronized when profiles change and unregister them on app shutdown.
- [ ] Run `npm --prefix desktop run build` and confirm the Electron main/preload bundle and shared renderer compile.

### Task 4: Add Tauri Windows source enumeration, shortcut registration, and isolated audio

**Files:**
- Modify: `desktop-tauri/src-tauri/Cargo.toml`
- Modify: `desktop-tauri/src-tauri/Cargo.lock`
- Modify: `web/package.json`
- Modify: `desktop-tauri/src-tauri/capabilities/default.json`
- Modify: `desktop-tauri/src-tauri/src/lib.rs`
- Create: `desktop-tauri/src-tauri/src/windows_targets.rs`
- Modify: `desktop-tauri/src-tauri/tauri.conf.json`
- Modify: `desktop-tauri/src-tauri/build.rs` if native helper linking/resource staging requires it
- Reuse/package: `desktop/native/windows/process-audio.cpp`, `desktop/native/windows/CMakeLists.txt`, and `desktop/resources/`
- Modify: `web/src/lib/tauri-desktop.ts`

**Interfaces:**
- Implements `listCaptureTargets`, `resolveCaptureTarget`, and `onShortcutProfile` from Task 2. Shortcut registration uses the official Tauri JavaScript plugin API from `@tauri-apps/plugin-global-shortcut`.
- Tauri runtime target IDs encode validated HWND/HMONITOR values as opaque session IDs, not arbitrary commands or paths; stable selectors are resolved to these IDs immediately before capture.
- Audio start accepts a freshly resolved `audioSourceId` and returns the current `{ captureId, format }` contract used by `web/src/lib/desktop.ts`.

- [ ] Add the Tauri v2 Rust and JavaScript global-shortcut plugins, initialize the Rust plugin, grant only required capability permissions, and translate registered shortcut activation into a typed window event.
- [ ] Implement Windows-only enumeration for visible app windows and monitors, returning process IDs and opaque source IDs; provide a clear unsupported result on non-Windows builds.
- [ ] Stage or build the existing WASAPI process-audio helper for Tauri Windows packaging and expose validated start/resume/stop/data/error commands/events.
- [ ] Update Tauri config to advertise available audio and both capture methods on supported Windows builds; keep feature capability flags false on unsupported platforms.
- [ ] Run `cargo fmt --check`, `cargo check` for the host target and `npm --prefix web run build`; record that Windows-only runtime checks require Windows.

### Task 5: Implement Tauri direct Windows.Graphics.Capture

**Files:**
- Create: `desktop-tauri/src-tauri/src/windows_capture.rs`
- Modify: `desktop-tauri/src-tauri/src/lib.rs`
- Modify: `desktop-tauri/src-tauri/Cargo.toml`
- Modify: `desktop-tauri/src-tauri/Cargo.lock`
- Modify: `web/src/desktop-bridge.d.ts`
- Modify: `web/src/lib/tauri-desktop.ts`
- Modify: `web/src/lib/desktop.ts`

**Interfaces:**
- Native bridge commands: `start_direct_video_capture(source_id, settings) -> VideoCaptureDescriptor`, `stop_direct_video_capture(capture_id) -> ()`, and event subscription for video frames/metadata according to the approved Task 1 bridge.
- `captureDesktopWindow(target, settings, desktopConfig, options)` accepts a freshly resolved target and `options: { captureMethod: "windows-picker" | "direct", audioSourceId: string }` and returns one owned `MediaStream`; the returned tracks use the existing release lifecycle.

- [ ] Implement WGC capture-item creation for validated HWND and HMONITOR source IDs, frame pool/session startup, resize/device-loss handling, and capture-ID ownership.
- [ ] Connect the Task 1 bridge to a renderer `MediaStreamTrack` adapter and cap frame work to requested FPS/resolution without raw full-frame Tauri event forwarding.
- [ ] Add stop/error paths that close frame pools, sessions, bridge resources, and video tracks exactly once.
- [ ] Preserve the Windows picker path with `getDisplayMedia`, enabling both windows and monitors; validate cancellation and unsupported selections.
- [ ] Merge the explicitly selected WASAPI process audio into the selected video stream using the existing shared capture path; never fall back to system audio.
- [ ] Run TypeScript build plus native compile checks available in the environment; verify capture and teardown on Windows before marking the Tauri direct mode complete.

### Task 6: Add profile management UI and connect host activation to broadcast

**Files:**
- Create: `web/src/components/ShortcutProfiles.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/index.css`
- Modify: `web/src/lib/desktop.ts`
- Modify: `web/src/lib/tauri-desktop.ts`
- Modify: `web/src/desktop-bridge.d.ts`

**Interfaces:**
- Consumes `ShortcutProfile` storage and host bridge from Tasks 2–5.
- Profile editor receives `targets`, `onRefresh`, `onSave`, and `onDelete`; the parent resolves `videoTarget.selector` and `audioSourceSelector` to current host IDs before calling `startBroadcast(profile.settings, target, profile)`.
- `startBroadcast(settings, target, profile)` refuses duplicate active capture and reports capture failures through the existing app error surface. `profile` supplies `captureMethod`; its audio selector is resolved to the current runtime ID before capture.

- [ ] Add profile list and editor with running window/monitor select, Tauri capture-method select, explicit audio-program select, and shortcut recording input.
- [ ] Default a window profile's audio source to the same app; require an explicit app audio source for monitor profiles.
- [ ] Refresh targets on demand, resolve stable selectors to current runtime IDs at each activation, and mark profiles unavailable instead of silently remapping a missing selector.
- [ ] Register saved shortcuts with the active host, display per-profile registration errors, and remove old registrations when edits/deletions occur.
- [ ] Connect shortcut events to `startBroadcast(profile.settings, profile.videoTarget, profile)`; prevent a second broadcast and show local notification/error for missing destination or failed isolated audio.
- [ ] Keep existing manual start/settings controls functional and make the Tauri method choice visible only in Tauri profile editing.
- [ ] Run `npm --prefix web run build` and `npm --prefix desktop run build`.

### Task 7: Package Windows support and document usage

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop-tauri/src-tauri/tauri.conf.json`
- Modify: `desktop/config.example.json` only if new user configuration is required
- Modify: `desktop-tauri/config.example.json` only if new user configuration is required
- Modify: `README.md` and desktop documentation as appropriate

**Interfaces:**
- Packaged builds include required native audio resources and register global shortcut/native capture plugins using least required permissions.

- [ ] Ensure packaged Electron and Tauri builds include the WASAPI helper and that resource lookup works in development and packaged paths.
- [ ] Document Windows version requirements, profile setup, picker/direct behavior, monitor audio-source requirement, and shortcut conflicts.
- [ ] Run available frontend builds, `cargo fmt --check`, and Tauri/Electron packaging commands; distinguish platform/toolchain limits from code failures.
- [ ] Perform a Windows smoke check for both Tauri modes, hotkey activation while minimized, isolated program audio, monitor video, profile persistence, and complete teardown.
