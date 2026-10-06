# P2P-Cast Expo Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Android-first Expo and React Native P2P-Cast client in `app-react-native/` with native Kotlin screen/camera capture, WebRTC video/PiP, existing PeerJS interoperability, web-inspired UI, and EAS Update configuration.

**Architecture:** Expo Router owns the React Native screens, settings, routes, and user-facing session state. A local Expo module owns Android capture, WebRTC/PeerJS sessions, chat transport, the native track renderer, and PiP; it adapts the current Kotlin client patterns without changing the existing Android app. EAS Update is configured with the supported CLI flow and separate preview/production channels; no update is published during implementation.

**Tech Stack:** Expo SDK 57, React Native and Expo Router from the default Expo template, Expo Modules API with Kotlin, `io.getstream:stream-webrtc-android:1.3.10` plus its UI artifact, OkHttp 5.5.0, Kotlin serialization 1.9.0, coroutines 1.10.2, AsyncStorage at the Expo-compatible version, `expo-updates` at the SDK-compatible version, and EAS CLI via `npx eas-cli@latest`.

**Spec:** [2026-10-06-app-react-native-design.md](../specs/2026-10-06-app-react-native-design.md)

## Global Constraints

- Target Android in this first version. iOS capture, playback, and PiP are outside this delivery.
- Create a separate Expo application in `app-react-native/`; keep the current `android/`, `web/`, desktop clients, and backend usable.
- Use Expo SDK 57 and install Expo packages with `npx expo install`.
- Use Expo Router, a unique Android application ID beside `com.p2pcast.android`, and the deep link scheme `p2pcast-react-native`.
- Preserve the current PeerJS Cloud signaling and WebRTC media protocol, the STUN-only policy, screen/camera track separation, and the limit of two active media connections per viewer session.
- Use the web palette: background `#07111f`, cyan `#75e5e0`, and the dark blue panel/muted text colors recorded in the spec. All user-facing copy is Brazilian Portuguese.
- Screen audio must be represented as available only when Android and the captured app allow it. Microphone remains a separate track paired with camera media when enabled.
- Configure EAS Update with CLI-generated project/runtime configuration and `preview`/`production` channels. Do not publish OTA content, create an EAS build, or submit an app as part of this plan.
- OTA changes are limited to compatible JavaScript and assets. Native module, permission, or dependency changes require a new native binary and compatible runtime.
- Do not add or run automated tests unless the user separately asks for testing or verification.

## Review Focus

- MediaProjection denial or revocation must release all capture resources and the foreground service. Owner: Task 5.
- In `both` mode, failure to acquire either screen or camera must clean up the other source instead of publishing a partial session. Owner: Task 5.
- Unsupported screen audio must appear unavailable and must never be represented as transmitted. Owner: Tasks 2, 5, and 7.
- Browser, existing Android, and Expo clients must exchange the same media metadata and chat data-channel messages. Owner: Tasks 4, 8, and 9.
- A runtime/channel mismatch must not deliver an OTA update to an incompatible binary. Owner: Task 10.

---

### Task 1: Scaffold the standalone Expo app

**Files:**
- Create: `app-react-native/` from the default Expo Router and TypeScript template.
- Modify: `app-react-native/app.json`
- Modify: generated routes under `app-react-native/app/`
- Create: `app-react-native/app/broadcast.tsx`
- Create: `app-react-native/app/watch/[peerId].tsx`

**Interfaces:**
- Produces: app route `/` for home, `/broadcast` for broadcasting, and `/watch/[peerId]` for a live viewer.
- Produces: app scheme `p2pcast-react-native://watch/<peerId>` and Android package `com.p2pcast.reactnative` so this app installs beside `com.p2pcast.android`.

- [x] **Step 1: Generate the default Expo Router app**

Run from the repository root:

```sh
npx create-expo-app@latest app-react-native --yes
```

Keep the generated `package-lock.json`, `tsconfig.json`, Babel/Metro configuration, and Expo Router template setup.

- [x] **Step 2: Configure Android identity and routing**

In `app.json`, retain generated Expo Router plugins and set the relevant Expo fields:

```json
{
  "expo": {
    "name": "P2P-Cast",
    "slug": "app-react-native",
    "scheme": "p2pcast-react-native",
    "platforms": ["android"],
    "android": { "package": "com.p2pcast.reactnative" }
  }
}
```

Keep the generated `app/_layout.tsx`, replace the example tabs with the three routes listed in this task, and route a root `?watch=<peer-id>` query to the viewer screen.

- [x] **Step 3: Replace starter content with route shells**

Create home, broadcast, and viewer route components with named screen components and typed route params. The home route accepts pasted watch URLs or raw peer IDs; the broadcast/viewer routes render branded loading and error shells until the native session UI is added.

- [x] **Step 4: Commit the scaffold**

```sh
git add app-react-native
git commit -m "feat: scaffold Expo Android app"
```

### Task 2: Define shared capture, room, chat, and preference types

**Files:**
- Create: `app-react-native/src/domain/capture.ts`
- Create: `app-react-native/src/domain/room.ts`
- Create: `app-react-native/src/domain/chat.ts`
- Create: `app-react-native/src/storage/preferences.ts`
- Create: `app-react-native/src/theme/tokens.ts`
- Modify: `app-react-native/package.json` and `app-react-native/package-lock.json`

**Interfaces:**
- Produces `CaptureSettings` with source `"screen" | "camera" | "both"`, resolution labels matching `android/app/src/main/java/com/p2pcast/android/capture/CaptureSettings.kt`, FPS/bitrate options matching `web/src/lib/capture.ts`, `screenAudio`, `microphone`, and `cameraFacing`.
- Produces `parseWatchTarget(input: string): string | null` and `buildWatchUrl(origin: string, peerId: string): string`.
- Produces `ChatMessage` with the existing fields `id`, `authorName`, `text`, `timestamp`, and `isBroadcaster`; chat text/name limits remain 500/40 characters.
- Produces async preference methods `loadCaptureSettings()`, `saveCaptureSettings(settings)`, `loadViewerName()`, `saveViewerName(name)`, `loadViewerVolume()`, `saveViewerVolume(volume)`, and chat-sound equivalents backed by AsyncStorage.

- [x] **Step 1: Add the typed settings catalogue and defaults**

Port the source, resolution, FPS, bitrate, microphone, screen-audio, and camera-facing options from the web/native clients. Keep the default at screen, 1080p, 30 FPS, 6 Mbps, screen audio on where available, microphone on, and front camera.

- [x] **Step 2: Add URL and chat domain helpers**

Parse a bare peer ID, the `watch` query from a web URL, and the `p2pcast-react-native://watch/<id>` path. Sanitize chat input to the existing maximum lengths and preserve the current message JSON field names.

- [x] **Step 3: Add persistent preferences and design tokens**

Install AsyncStorage with `npx expo install @react-native-async-storage/async-storage`. Persist settings, viewer name, viewer volume, and chat sound. Define background, panel, border, text, muted, cyan, green, blue, danger, spacing, and corner-radius tokens from the web palette.

- [x] **Step 4: Commit domain and theme foundations**

```sh
git add app-react-native/src app-react-native/package.json app-react-native/package-lock.json
git commit -m "feat: add Expo capture and room models"
```

### Task 3: Create the local Expo media module and typed bridge

**Files:**
- Create: `app-react-native/modules/p2pcast-media/` from `npx create-expo-module@latest --local p2pcast-media`.
- Create: `app-react-native/modules/p2pcast-media/expo-module.config.json`
- Create: `app-react-native/modules/p2pcast-media/src/P2PCastMedia.types.ts`
- Create: `app-react-native/modules/p2pcast-media/src/P2PCastMediaModule.ts`
- Modify: `app-react-native/package.json`
- Modify: `app-react-native/tsconfig.json` if needed for the module alias.

**Interfaces:**
- `NativeSessionMode = "idle" | "starting" | "broadcasting" | "connecting" | "watching" | "error"`.
- `NativeMediaEvent` variants: `stateChanged`, `shareUrlChanged`, `viewerCountChanged`, `trackChanged`, `chatMessage`, `chatReadyChanged`, `screenAudioCapabilityChanged`, and `pipModeChanged`.
- Module methods: `requestCapturePermissions(settings)`, `startBroadcast(settings, webOrigin): Promise<string>`, `startViewer({ broadcastId, viewerId, viewerSessionId }): Promise<string>`, `stopSession()`, `retryViewer()`, `setMicrophoneMuted(muted)`, `setViewerAudio(enabled, volume)`, `flipCamera()`, `sendChatMessage(text, name?)`, `enterPictureInPicture(): Promise<boolean>`, and `addListener(eventName, listener)`.
- Native video view props: `sessionId`, source `"screen" | "camera"`, `scaleMode: "contain" | "cover"`, and optional `mirror`.

- [x] **Step 1: Generate and register an Android-only local Expo module**

From `app-react-native/`, run:

```sh
npx create-expo-module@latest --local p2pcast-media
```

Keep the generated module Android-only in `expo-module.config.json` and register its local package in the Expo app according to the generated SDK 57 template.

- [x] **Step 2: Add the TypeScript module facade**

Create typed event and method declarations matching the interfaces above. Export a single `P2PCastMedia` facade and a `P2PCastVideoView` native component from the module entry point. Use typed subscriptions with a disposer so React effects can remove listeners.

- [x] **Step 3: Add the Kotlin module definitions**

Create `P2PCastMediaModule.kt` with the same method/event names and explicit errors for methods called before a native session exists. Keep session ownership in the module/controller layer, not in screen components.

- [x] **Step 4: Commit the module boundary**

```sh
git add app-react-native/modules/p2pcast-media app-react-native/package.json app-react-native/tsconfig.json
git commit -m "feat: add P2P-Cast Expo media module"
```

### Task 4: Port PeerJS signaling, RTC sessions, and chat transport

**Files:**
- Create under `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/`:
  - `signaling/PeerSignalingClient.kt`
  - `signaling/SdpCodec.kt`
  - `capture/CaptureSettings.kt`
  - `rtc/PeerLink.kt`
  - `rtc/WebRtcEngine.kt`
  - `rtc/RtcBroadcastSession.kt`
  - `rtc/RtcViewerSession.kt`
  - `rtc/RtcSession.kt`
  - `chat/ChatModels.kt`
  - `chat/ChatControllers.kt`
  - `SessionController.kt`
- Modify: `app-react-native/modules/p2pcast-media/android/build.gradle`
- Modify: `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/P2PCastMediaModule.kt`

**Interfaces:**
- `SessionController.startBroadcast(settings: CaptureSettings, webOrigin: String): String` returns a stable session ID and emits mode/share URL/viewer count events.
- `SessionController.startViewer(broadcastId: String, viewerId: String, viewerSessionId: String): String` returns a stable session ID and emits mode/remote-track/chat events.
- `SessionController.stopSession()` closes signaling, RTC connections, tracks, and chat links idempotently.
- The JS bridge methods from Task 3 call these controller methods; the Kotlin module translates `StateFlow` updates to the corresponding Expo events.

- [x] **Step 1: Add WebRTC and signaling dependencies**

Declare the same media and utility artifacts pinned by the current Android app: `io.getstream:stream-webrtc-android:1.3.10`, `io.getstream:stream-webrtc-android-ui:1.3.10`, OkHttp `5.5.0`, Kotlin serialization JSON `1.9.0`, and coroutines Android `1.10.2`.

- [x] **Step 2: Add native capture settings types**

Create `capture/CaptureSettings.kt` with `CaptureSource`, `CaptureTrackSource`, `CameraFacing`, `Resolution`, FPS/bitrate options, and `CaptureSettings`. Map the TypeScript source/resolution labels explicitly instead of relying on enum-name coincidence.

- [x] **Step 3: Port the PeerJS socket and payload codec**

Adapt `android/app/src/main/java/com/p2pcast/android/signaling/PeerSignalingClient.kt` and `SdpCodec.kt`. Preserve the PeerJS Cloud URL/key, 5-second heartbeat, OPEN/ERROR/LEAVE/EXPIRE/OFFER/ANSWER/CANDIDATE handling, SDP and ICE envelope fields, and the no-`src` outgoing-message rule.

- [x] **Step 4: Port RTC broadcast/viewer session logic**

Adapt the existing `PeerLink`, broadcast session, viewer session, and shared session interfaces. Preserve separate screen/camera media connections, the `viewer` and `chat` metadata roles, `viewerId`/`viewerSessionId`, STUN-only ICE, bitrate selection, and the maximum of two active media connections for each viewer session.

- [x] **Step 5: Bridge session state and chat events**

Keep the current chat JSON format and viewer-name fallback. Map Kotlin state changes to Task 3's typed Expo events; ignore malformed chat payloads and close a peer's media and chat links on LEAVE/EXPIRE.

- [x] **Step 6: Commit the compatible RTC engine**

```sh
git add app-react-native/modules/p2pcast-media/android
git commit -m "feat: add PeerJS-compatible native RTC sessions"
```

### Task 5: Implement screen/camera capture, permissions, and foreground lifecycle

**Files:**
- Create under `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/`:
  - `capture/ScreenCapturerFactory.kt`
  - `capture/CameraCapturerFactory.kt`
  - `capture/CapturePermissionController.kt`
  - `service/StreamForegroundService.kt`
  - `service/SessionRegistry.kt`
- Create: `app-react-native/modules/p2pcast-media/android/src/main/AndroidManifest.xml`
- Create: `app-react-native/modules/p2pcast-media/app.plugin.js`
- Modify: `app-react-native/modules/p2pcast-media/android/build.gradle`
- Modify: `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/rtc/RtcBroadcastSession.kt`
- Modify: `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/P2PCastMediaModule.kt`
- Modify: `app-react-native/app.json`

**Interfaces:**
- `CapturePermissionController.request(settings): Promise<CapturePermissionResult>` resolves with permission/capability state; it never returns MediaProjection `Intent` data to JavaScript.
- `SessionRegistry` owns one active broadcast or viewer session per app process and lets a recreated React view subscribe to it.
- `CaptureSettings` maps TypeScript source/resolution/FPS/bitrate/audio/facing fields to the existing Android Kotlin model.

- [x] **Step 1: Add native capture settings and camera capturer**

Port the supported resolution, FPS, bitrate, and camera-facing catalogue from the current Android app. Use `Camera2Enumerator`, preferring the requested facing direction and falling back to an available camera.

- [x] **Step 2: Add permission and MediaProjection consent flow**

Implement Android runtime permission requests for camera/microphone and the MediaProjection system consent result for screen capture. Hold projection data only in native memory. If the user denies a permission, return a typed permission result and do not call `startBroadcast`.

- [x] **Step 3: Add the foreground service and config plugin**

Declare camera, microphone, media-projection, notification, and applicable foreground-service permissions/types. Add a persistent low-noise notification while capture is active. Register the service using the module manifest/config plugin so `expo prebuild` and EAS builds include it.

- [x] **Step 4: Connect screen/camera tracks to the session controller**

Start requested capturers before signaling opens; if either requested source fails, stop every source and close the session. Add the microphone to the camera media connection only when requested. Add screen playback audio only when it is actually available on the Android version and captured app; emit capability state so the UI disables unavailable capture.

- [x] **Step 5: Preserve the session across activity recreation**

Keep the native registry/service as owner while the activity is temporarily recreated. On MediaProjection revocation, stop capturers, peers, and service and emit an error. Use a non-sticky process-death policy: after process termination the next launch starts at home and does not restore a stale session.

- [x] **Step 6: Commit capture and lifecycle support**

```sh
git add app-react-native/modules/p2pcast-media app-react-native/app.json
git commit -m "feat: add Android screen and camera capture"
```

### Task 6: Render WebRTC tracks and support Android PiP

**Files:**
- Create: `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/P2PCastVideoView.kt`
- Create: `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/PictureInPictureController.kt`
- Modify: `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/P2PCastMediaModule.kt`
- Create: `app-react-native/modules/p2pcast-media/android/src/main/java/expo/modules/p2pcastmedia/P2PCastMediaViewModule.kt`
- Modify: `app-react-native/modules/p2pcast-media/app.plugin.js`
- Modify: `app-react-native/modules/p2pcast-media/src/P2PCastMedia.types.ts`
- Modify: `app-react-native/modules/p2pcast-media/src/P2PCastMediaModule.ts`
- Modify: `app-react-native/modules/p2pcast-media/expo-module.config.json`

**Interfaces:**
- `P2PCastVideoView({ sessionId, source, scaleMode, mirror })` renders the matching local or remote `VideoTrack` and detaches the renderer when the view/session changes.
- `enterPictureInPicture(): Promise<boolean>` and `onPipModeChanged({ isInPictureInPictureMode })` expose PiP to the viewer screen.

- [x] **Step 1: Bind native video tracks to an Expo view**

The SDK 57 `expo-video` API check is already complete: it exposes its own `VideoPlayer`/`VideoView` source model and does not accept a WebRTC track. Do not add `expo-video` as the live renderer dependency. Create an Android `ExpoView` containing a WebRTC `SurfaceViewRenderer`. Resolve the requested track by session ID/source; attach it as a sink on mount/update, apply contain/cover and mirror behavior, and remove the sink/release EGL resources on detach.

- [x] **Step 2: Configure Android PiP through the module plugin**

Set activity PiP support, required configuration-change flags, and a 16:9 default aspect ratio through the local config plugin. Enter PiP only when a viewer session has an active primary video track; emit mode changes back to JavaScript.

- [x] **Step 3: Keep the viewer usable when PiP is unavailable**

Return `false` or a typed module error when the device lacks PiP support or there is no live track. The app must keep the in-app viewer and controls visible in that state.

- [x] **Step 4: Commit renderer and PiP integration**

```sh
git add app-react-native/modules/p2pcast-media
git commit -m "feat: render WebRTC video and add PiP"
```

### Task 7: Build the home screen and settings flow

**Files:**
- Create: `app-react-native/src/components/AppHeader.tsx`
- Create: `app-react-native/src/components/StatusPill.tsx`
- Create: `app-react-native/src/components/PrimaryButton.tsx`
- Create: `app-react-native/src/components/CaptureSettingsPanel.tsx`
- Create: `app-react-native/src/screens/HomeScreen.tsx`
- Modify: `app-react-native/app/index.tsx`
- Modify: `app-react-native/src/theme/tokens.ts`

**Interfaces:**
- `HomeScreen` receives `settings`, `onSettingsChange(settings)`, `onStartBroadcast()`, and `onWatch(input)` props.
- `CaptureSettingsPanel` receives `settings`, `screenAudioAvailable`, and `onChange(settings)`; it hides/disabled the unsupported audio option and persists the user's selections through Task 2 preferences.

- [x] **Step 1: Build the branded home hierarchy**

Recreate the web header/brand mark, kicker, two-line headline, description, settings summary, and call-to-action using React Native layout primitives and the Task 2 tokens. Use a single-column mobile layout and preserve the web's typographic/color hierarchy.

- [x] **Step 2: Add capture settings controls**

Add source, resolution, FPS, bitrate, screen-audio availability, microphone, and front/rear camera controls. Consult the Expo UI component guidance before choosing controls; select components that support the custom P2P-Cast palette and the requested native behavior.

- [x] **Step 3: Add watch-link entry**

Accept a full shared URL or bare peer ID, pass it through `parseWatchTarget`, show a useful invalid-link state, and navigate to `/watch/[peerId]` when parsing succeeds.

- [x] **Step 4: Commit the home/settings UI**

```sh
git add app-react-native/src app-react-native/app/index.tsx
git commit -m "feat: build Expo home and capture settings"
```

### Task 8: Connect and present native broadcasts

**Files:**
- Create: `app-react-native/src/session/MediaSessionProvider.tsx`
- Create: `app-react-native/src/session/useBroadcastSession.ts`
- Create: `app-react-native/src/components/VideoStage.tsx`
- Create: `app-react-native/src/components/ChatPanel.tsx`
- Create: `app-react-native/src/screens/BroadcastScreen.tsx`
- Modify: `app-react-native/app/broadcast.tsx`
- Modify: `app-react-native/modules/p2pcast-media/src/P2PCastMedia.types.ts`

**Interfaces:**
- `useBroadcastSession()` returns `{ sessionId, mode, error, shareUrl, viewerCount, tracks, chatMessages, chatReady, start(settings), stop(), setMicrophoneMuted(muted), flipCamera(), sendChatMessage(text) }`; `sessionId` is `string | null` so `VideoStage` can bind to the module-owned native tracks.
- `MediaSessionProvider` subscribes once to module events and removes every native subscription on unmount.
- `VideoStage` consumes `{ sessionId, screenTrackAvailable, cameraTrackAvailable }` and renders separate Expo video views.

- [x] **Step 1: Add a typed native-session event provider**

Subscribe to Task 3/4 events, keep one normalized session state object, and expose broadcast actions through `useBroadcastSession`. Ignore stale events from a session ID that has already stopped.

- [x] **Step 2: Implement broadcast startup and cleanup**

Request only permissions required by the selected source, request MediaProjection consent for screen capture, then start the native broadcast with `https://live.ligmacharl.es` as the default web origin. Stop native capture and reset state if startup fails or the user leaves.

- [x] **Step 3: Build the local stage and broadcast controls**

Render screen and camera previews as separate tracks, use camera as a floating 9:16 overlay over screen when both exist, and show mode, viewer count, share link, copy/share actions, mic mute, camera flip, chat, and stop controls.

- [x] **Step 4: Commit the broadcast flow**

```sh
git add app-react-native/src app-react-native/app/broadcast.tsx app-react-native/modules/p2pcast-media/src
git commit -m "feat: add native broadcast screen"
```

### Task 9: Connect viewer links, media, chat, and PiP

**Files:**
- Create: `app-react-native/src/session/useViewerSession.ts`
- Create: `app-react-native/src/screens/ViewerScreen.tsx`
- Modify: `app-react-native/app/watch/[peerId].tsx`
- Modify: `app-react-native/app/_layout.tsx`
- Modify: `app-react-native/src/components/ChatPanel.tsx`
- Modify: `app-react-native/src/components/VideoStage.tsx`

**Interfaces:**
- `useViewerSession(broadcastId)` returns `{ mode, error, sessionId, screenTrackAvailable, cameraTrackAvailable, chatMessages, chatReady, audioEnabled, volume, retry(), leave(), setAudioEnabled(enabled), setVolume(volume), sendChatMessage(text, name?), enterPictureInPicture() }`.
- The `/watch/[peerId]` route and root `?watch=<peer-id>` query both start that viewer hook with the parsed ID.

- [x] **Step 1: Implement viewer startup and source state**

Create persistent `viewerId` and per-view `viewerSessionId` values, call `startViewer`, request screen and camera as separate receive-only media connections, and map remote track/chat events to the viewer state.

- [x] **Step 2: Render the viewer stage and controls**

Show screen as the primary stage when present, otherwise camera. Float camera as a portrait overlay when both sources arrive. Keep viewer audio disabled until activated; map mute/volume controls to remote WebRTC audio tracks.

- [x] **Step 3: Complete chat and PiP behavior**

Render the shared chat panel with viewer name, unread count, sound preference, sanitized messages, and the current JSON protocol. Show PiP only for a live primary track; hide chat and in-app buttons while Android reports PiP active; stop the session on leave.

- [x] **Step 4: Handle incoming links and recoverable errors**

Handle the `p2pcast-react-native://watch/<id>` scheme, forwarded shared text URLs, malformed/expired IDs, retry, and return-home navigation. Keep the original generated HTTPS watch URL for sharing with web and Android clients.

- [x] **Step 5: Commit the viewer flow**

```sh
git add app-react-native/src app-react-native/app
git commit -m "feat: add live viewer chat and PiP"
```

### Task 10: Configure EAS Update and document release operations

**Files:**
- Modify: `app-react-native/package.json` and `app-react-native/package-lock.json`
- Modify: `app-react-native/app.json`
- Create or modify through EAS CLI only: `app-react-native/eas.json`
- Create: `app-react-native/README.md`
- Modify: repository `README.md`

**Interfaces:**
- `preview` build profile uses EAS channel `preview` and production profile uses channel `production`.
- App config contains only the project URL, project ID, and runtime policy written/selected by the supported EAS CLI setup.
- Future publishing instructions use `npx eas-cli@latest update --channel <channel> --message <message> --environment <environment>`; this plan does not execute that command.

- [x] **Step 1: Install SDK-compatible EAS Update support**

From `app-react-native/`, run:

```sh
npx expo install expo-updates
npx eas-cli@latest whoami
```

If `whoami` indicates there is no authenticated Expo account, stop this task and ask the user to complete Expo authentication before continuing.

- [x] **Step 2: Generate EAS project and build-profile configuration**

If `eas.json` is absent, run `npx eas-cli@latest build:configure` and preserve the generated development/preview/production profiles. Then run `npx eas-cli@latest update:configure --platform android`; allow the command to link/create the EAS project and write `updates.url`, `runtimeVersion`, `extra.eas.projectId`, and profile channels. Do not hand-write or replace CLI-generated runtime/project identifiers.

- [x] **Step 3: Review the CLI-generated EAS diff**

Review the changes to `app.json`, `eas.json`, and any generated Android update configuration. Keep preview and production mapped to channels of the same names. Do not run `eas update`, `eas build`, or submission commands.

- [x] **Step 4: Document OTA and native-build boundaries**

In both READMEs, document the Expo account/project requirement, development command, Android custom-module build path, preview/production channels, the requirement for a new binary after native changes, the future publish command including `--environment`, and release update activation after the app downloads and later restarts.

- [x] **Step 5: Commit EAS setup and documentation**

```sh
git add app-react-native README.md
git commit -m "feat: configure EAS Update for Expo app"
```

## Plan self-review

- **Spec coverage:** Tasks 1–9 implement the Expo app, Kotlin capture/session module, compatible PeerJS/WebRTC transport, chat, links, renderer, PiP, and visual system. Task 10 configures EAS Update and documents supported OTA/rebuild operations. All nine acceptance criteria have an owning task.
- **Placeholder scan:** No placeholder implementation steps remain. Every file, method, command, route, and channel referenced above is named in this plan or the approved spec.
- **Interface consistency:** Tasks 3–6 share the `P2PCastMedia` method/event/view contract; Task 8 and Task 9 consume that contract through separate session hooks. The broadcast URL origin is consistently `https://live.ligmacharl.es`; the native scheme is consistently `p2pcast-react-native`.
- **Review focus mapping:** Capture permission/revocation and atomic cleanup are in Task 5; screen-audio capability is in Tasks 2/5/7; cross-client signaling/chat is in Tasks 4/8/9; EAS runtime/channel compatibility is in Task 10.
- **Automated tests:** No automated tests or test-run steps are included, per the current instruction not to add or run tests without an explicit request.
