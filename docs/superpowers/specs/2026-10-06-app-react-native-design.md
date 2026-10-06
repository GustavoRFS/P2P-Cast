# P2P-Cast Expo Android app

**Status:** Draft for user review

**Date:** 2026-10-06

## Goal

Create `app-react-native/`, an Android-first Expo and React Native client for broadcasting and watching P2P-Cast lives, visually based on `web/`, compatible with the existing web and Android clients, and configured to receive compatible JavaScript and asset updates through EAS Update.

## Context

- `web/` uses PeerJS Cloud for signaling and direct WebRTC for media. A watch link contains `?watch=<peer-id>` and the signaling service does not carry media.
- `android/` implements the PeerJS signaling envelope with a Kotlin WebSocket client and WebRTC sessions. It captures Android screen and camera video, sends a microphone track with camera video when enabled, handles chat data channels, and limits each viewer session to two media connections.
- The existing web client can publish screen video and audio plus camera video and microphone audio. Android's existing capture settings include a screen-audio toggle, but the current RTC broadcaster only adds the microphone track for camera video. The new client must report actual screen-audio capability and must not show an enabled control when it cannot deliver that audio.
- The web design uses a near-black navy background (`#07111f`), dark blue panels, pale text, muted blue secondary text, and cyan highlights (`#75e5e0`). Its home screen has a large two-line headline and a compact settings panel; live screens make the video stage primary, with secondary controls and chat.
- Expo's current `expo-video` provides PiP for its `VideoPlayer`/`VideoView` native player. Its documented source model does not accept a WebRTC media track. This is an inference from the current [Expo Video API](https://docs.expo.dev/versions/latest/sdk/video/), which documents URI/asset sources and player instances but no `MediaStream` input.

## Approved scope and assumptions

- Target Android in this first version. iOS capture, playback, and PiP are outside this delivery.
- Create a separate Expo application in `app-react-native/`; keep the current `android/`, `web/`, desktop clients, and backend usable.
- Use Expo SDK 57, the latest stable SDK shown in the Expo reference as of this spec date. Use its compatible `expo-video` package (currently documented as `~57.0.5`) as the supported-library check, and install Expo packages with `npx expo install`.
- Use Expo Router for app routes and watch-link handling. Give the app a unique Android application ID so it installs beside `com.p2pcast.android`.
- Use React Native screens for the home, broadcast, and viewer flows. Use a local Expo module implemented in Kotlin for the Android media engine, screen capture, camera capture, native WebRTC video rendering, and PiP.
- Preserve the current PeerJS Cloud signaling and WebRTC media protocol. Do not add a media server, change the existing clients' wire format, or require the backend for live video.
- Configure EAS Update, including the EAS project association, a CLI-generated runtime/update configuration, and separate `preview` and `production` update channels. Configuration does not publish an update or start a build.
- OTA updates carry compatible JavaScript and assets. Changes to the native module, native permissions, or native dependencies require a new native binary; runtime compatibility must follow the EAS-generated policy.

## Architecture

### Expo application

`app-react-native/` owns the React Native presentation, persisted UI preferences, route/deep-link handling, settings validation, and display of native session state. Its screens mirror the product structure in `web/src/App.tsx`:

1. Home: choose screen, camera, or both; configure resolution, FPS, bitrate, available audio inputs, microphone, and camera facing; start a broadcast or enter a watch link/code.
2. Broadcast: show local screen/camera preview, live state, viewer count, copy/share link actions, microphone mute, camera flip, and chat.
3. Viewer: connect from a watch link or entered peer ID; show the primary video and camera overlay when both tracks arrive; expose audio mute/volume, chat, retry/leave, and PiP controls.

Use the web app's wording, hierarchy, and color palette where the mobile viewport permits. Reflow the hero and settings into a single-column mobile layout while keeping the video stage dominant on live screens. Native dialogs and permission prompts follow Android conventions.

### Local Expo media module

Create `app-react-native/modules/p2pcast-media/` as a local Expo module. It owns Android-only media/session operations and exposes a typed TypeScript facade to the app. Adapt the Kotlin implementation patterns from `android/app/src/main/java/com/p2pcast/android/{capture,rtc,signaling,chat}` without making the existing Android client depend on Expo.

The module boundary must expose:

- requesting camera/microphone permissions and Android MediaProjection consent;
- starting/stopping a broadcast or viewer session, retrying a viewer, changing microphone state, flipping the camera, adjusting viewer audio, and sending chat messages;
- lifecycle events for mode, errors, watch/share URL, viewer count, local/remote track availability, chat messages, and chat readiness;
- an Expo native video view that binds to a session and a source (`screen` or `camera`), with layout behavior matching the existing contain/cover previews;
- entering/leaving Android PiP and notifying React Native when the activity changes PiP state.

The module must own WebRTC resources and close them when a session ends or the OS revokes capture permission. Screen capture requires Android's MediaProjection consent flow. Camera and microphone use Android runtime permissions. Long-running screen/camera broadcast must use an Android foreground service with the applicable service types and notification. Returning to the app while it remains in the same process must reattach the UI to the active native session. If Android terminates the app process, end the session and return to the home screen on the next launch rather than silently restoring a stale broadcast.

Screen audio is optional and may be unavailable on Android versions or source apps that disallow playback capture. The settings UI must represent this capability accurately. The microphone remains a separate setting and is sent only with a camera media connection when enabled, matching the current native protocol.

### Signaling and session compatibility

- Use the same PeerJS Cloud WebSocket endpoint, heartbeat cadence, SDP/ICE payload envelope, connection IDs, metadata roles, and chat JSON fields as the current clients.
- Keep screen and camera as separate media connections so existing web and Android clients can request either track. When publishing both, use the viewer identity/session metadata already understood by the current broadcaster.
- Keep the existing STUN-only policy and its connectivity ceiling. Do not silently add a TURN service.
- Retain the current broadcast-ID behavior and generate the ordinary web watch URL using the configured live-site origin. The Expo viewer accepts a pasted/shared web URL with `?watch=<id>`, a raw peer ID, and the app's `p2pcast-react-native://watch/<id>` deep link. Verified Android HTTPS App Links require the web host's Digital Asset Links file to include the new package and signing fingerprints; they are a deployment dependency, and if enabled later must preserve browser fallback and the existing web URL.
- Keep chat peer-to-peer over PeerJS data connections; the backend remains outside the media and chat path.
- Preserve the existing limit of two active media connections per viewer session and show a clear state when media or signaling fails.

### PiP and video playback

Use `expo-video` only if the current SDK exposes a supported way to render a remote WebRTC track. The current documented API does not, so the planned path is the Expo module's native WebRTC renderer plus Android's native PiP APIs. PiP is available only while watching a live video; exiting or leaving the viewer releases PiP and the media session according to Android lifecycle rules. The chat and in-app controls are hidden while the system PiP window is active.

### EAS Update

- Install the SDK-compatible `expo-updates` package with `npx expo install expo-updates`.
- Use `npx eas-cli@latest update:configure` from the Expo app root to configure `updates.url`, `runtimeVersion`, and `extra.eas.projectId`. Review and preserve any configuration generated by the CLI.
- Configure `preview` and `production` channels on their corresponding EAS Build profiles. If the new project's `eas.json` or EAS Build profiles are absent, use the supported EAS CLI setup flow rather than inventing the file or runtime values by hand.
- Do not run `eas update` to publish OTA content as part of this work. Do not create or submit an EAS build unless separately requested. After setup, document that the first binary must contain `expo-updates` and the custom native module before it can receive updates.
- SDK 55 and later require selecting an EAS environment when publishing. Future publish instructions must include channel, message, and environment.

The [official EAS Update setup guide](https://docs.expo.dev/eas-update/getting-started/) specifies the supported CLI path, project URL/runtime setup, channel configuration, and that release updates are applied after download and a later app restart.

## Failure behavior

- If the user denies MediaProjection consent, do not start the broadcast; return to the setup screen with a clear explanation and retry action.
- If camera or microphone permission is denied, do not leave a partial broadcast running. Explain which permission is needed and allow a retry after the user changes Android settings.
- If a requested capture source fails after another source started, stop all tracks and the native session so the UI cannot report a partial live unexpectedly.
- If screen audio is unsupported, keep screen video available and show that screen audio is unavailable; do not claim that device/game audio is being transmitted.
- If signaling, media negotiation, or the peer ID is invalid/expired, show a recoverable error with retry and leave actions and close stale RTC resources.
- If the OS ends MediaProjection, stop the stream and foreground service and return the UI to an error state with retry. Activity recreation in the same process must preserve the native session and notification; process termination ends the session and the next launch starts at home.
- If PiP is unsupported or cannot start, keep the viewer active in-app and show a non-blocking error/state.
- EAS Update must only deliver updates matching the build's platform and runtime. Native API changes use a new binary; never relax runtime compatibility just to force an update onto an incompatible build.

## Out of scope

- iOS support in the first delivery.
- Discord login, presence, account/whitelist features, and desktop window selection.
- TURN infrastructure, server-side media, recording, or changes to backend data flows.
- Publishing any OTA update, creating a release build, or submitting to an app store.
- Replacing or removing the existing `android/` or `web/` apps.

## Acceptance criteria

1. `app-react-native/` is an Expo project that installs and starts independently from `android/` and `web/`.
2. Its home, broadcast, and viewer screens preserve the web brand colors, wording, visual hierarchy, and mobile-friendly content flow.
3. Android users can grant capture permission and broadcast screen, camera, or both through the Expo media module, with the selected resolution/FPS/bitrate and available audio controls reflected in the actual session.
4. A web, existing Android, or Expo client can watch a live from another client using the current PeerJS protocol; screen and camera tracks remain separately requestable.
5. Viewer chat works with existing web and Android clients over PeerJS data connections; mute/volume, retry/leave, camera overlay, and viewer-count behavior are present.
6. The viewer can enter Android PiP with the active WebRTC video without routing it through a file/URL-based Expo Video player.
7. Denied/revoked permissions, unavailable capture sources, connection errors, and unsupported PiP leave no orphaned capture session and have clear UI states.
8. EAS Update is configured through the EAS CLI, the app has preview and production channels, and no OTA publication or build submission occurs during setup.
9. Documentation states the EAS account/project prerequisite, how to build a native binary that includes the module and `expo-updates`, how to publish a future update with channel/message/environment, and which native changes require a new build.

## Review focus

- MediaProjection denial or revocation must stop capture and leave no active foreground service.
- Permission granted for one source but denied for another in `both` mode must clean up both sources and not publish a partial stream.
- Unsupported screen-audio capture must not look enabled or transmit unexpected audio.
- Opening a web watch link with no query or an expired peer ID must show a useful error and leave retry available.
- PiP entry while connecting or after the track has ended must not strand the activity in a hidden viewer state.
- A JS update built for another runtime or channel must never be treated as compatible.
