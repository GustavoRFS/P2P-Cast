# P2P-Cast Desktop and Discord Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an Electron desktop client with single-window capture, isolated Windows application audio, optional Discord login, and live presence through an Elysia backend.

**Architecture:** Keep the existing React application and PeerJS rooms as the media client. Electron supplies secure window-capture and native-audio APIs through preload IPC. A Bun/Elysia service owns Discord OAuth, JSON whitelist checks, seven-day JWT sessions, and ephemeral live-presence signaling only.

**Tech Stack:** Existing React 19, TypeScript 5, Vite 6, PeerJS 1.5; Electron 40+, C++17/CMake/WASAPI on Windows; Bun, Elysia, `@elysia/cors`, and `jose` for JWT signing/verification.

**Spec:** `docs/superpowers/specs/2026-10-04-desktop-discord-presence-design.md`

## Global Constraints

- Preserve the existing signaling through `peerjs.ligmacharl.es` and the current watch URL format.
- Keep WebRTC media peer-to-peer; the new backend stores only current authenticated presence in memory.
- Discord login is optional; anonymous broadcast and watch continue to work if the backend is unavailable.
- Never use Electron global loopback audio. On Windows, capture audio from the selected process and its process tree only; elsewhere disable application audio.
- Keep Electron `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; renderer access goes through typed preload methods.
- Use `backend/whitelist.json` as an array of Discord IDs, with no real IDs committed.
- Preserve existing user modifications under `android/`.
- Do not add or run automated tests in this session. Run TypeScript/Vite and backend builds, and an Electron packaging build that the current OS supports.

## File Structure

- `backend/src/config.ts`: read required environment configuration, exact allowed app origins, and whitelist path.
- `backend/src/auth.ts`: Discord OAuth state/one-use desktop handoff code and user JWT.
- `backend/src/presence.ts`: authenticated WebSocket and in-memory live list.
- `backend/src/index.ts`: compose Elysia routes and start Bun listener.
- `backend/whitelist.example.json`, `backend/.env.example`, `backend/package.json`, `backend/tsconfig.json`: service setup and safe templates; the actual ignored `backend/whitelist.json` is created locally from the example.
- `desktop/src/main.cjs`: BrowserWindow, custom protocol, secure capture selection and WASAPI process lifecycle.
- `desktop/src/preload.cjs`, `desktop/src/renderer.d.ts`: restricted IPC API and TypeScript surface.
- `desktop/native/windows/CMakeLists.txt`, `desktop/native/windows/process-audio.cpp`: Windows per-process loopback helper.
- `desktop/scripts/dev.cjs`: run Vite and Electron together.
- `desktop/package.json`, `desktop/config.example.json`, `desktop/resources/.gitkeep`: packaging and runtime backend configuration.
- `web/src/lib/desktop.ts`: desktop detection, selected-window capture/audio bridge and capture cleanup.
- `web/src/lib/desktop-account.ts`: encrypted-session bridge, Discord login, and presence hook.
- `web/src/vite-env.d.ts`: includes the desktop preload API declaration in the web TypeScript project.
- `web/src/App.tsx`, `web/src/index.css`: window selector, Discord account state, live friends and deep link viewing.
- `README.md`: root instructions for running and packaging all three app surfaces.

## Review Focus

- User closes a selected window before capture or while streaming: capture fails visibly or stops, all tracks and helper processes terminate.
- WASAPI helper fails, returns malformed PCM, or has no application audio: do not switch to global/system loopback.
- User cancels Discord OAuth, opens a stale code, or tampers with the desktop handoff verifier: no JWT or presence socket is created.
- A non-whitelisted Discord ID signs in: callback returns an access-denied page and creates no exchange code.
- Backend disconnects while the user is streaming: stop/close presence and allow peer media to continue anonymously.

## Tasks

### Task 1: Build the Elysia Discord authorization service

**Files:**

- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.env.example`
- Create: `backend/whitelist.example.json`
- Modify: `.gitignore`
- Create: `backend/src/config.ts`
- Create: `backend/src/auth.ts`
- Create: `backend/src/index.ts`

**Interfaces:**

- `getConfig(): BackendConfig` returns `port`, `publicUrl`, `discordClientId`, `discordClientSecret`, `discordRedirectUri`, `jwtSecret`, and `whitelistPath`.
- `createAuthRoutes(config: BackendConfig): { router: Elysia, verifyAccessToken(token: string): Promise<DiscordProfile | null> }` adds `GET /auth/discord`, `GET /auth/discord/callback`, `POST /auth/exchange`, `GET /api/me`, and `POST /api/logout`.
- The exchange response is `{ token: string, user: { id: string, username: string, avatar: string | null } }`.
- Backend dev/build/start commands are `bun run dev`, `bun run build`, and `bun run start`.

- [x] **Step 1: Add the Elysia/Bun package and strict compiler setup**

  Create a private ESM package with dependencies `elysia`, `@elysia/cors`, and `jose`, dev dependency `typescript`, and the three scripts above. Set TypeScript `strict`, `target: ES2022`, `module: Preserve`, `moduleResolution: Bundler`, `noEmit: true`, and include `src/**/*.ts`.

- [x] **Step 2: Define configuration and sample allowlist data**

  Read `PORT` with default `3001`; require `PUBLIC_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, and `JWT_SECRET` in production; require a JWT secret of at least 32 characters. Resolve `WHITELIST_PATH` or default to `backend/whitelist.json`. Read `APP_ORIGINS` as an exact comma-separated list, defaulting to `p2pcast-app://desktop,http://127.0.0.1:5173,http://localhost:5173`. Treat a missing whitelist file as an empty list; the example explains that IDs are strings returned by Discord `/users/@me`. Add `.env.example` as an exception to the root `.env*` ignore rule and ignore the actual `backend/whitelist.json` file.

- [x] **Step 3: Implement the Discord login start and callback**

  `GET /auth/discord?code_challenge=...` accepts only a base64url SHA-256 desktop handoff challenge, creates a random 32-byte OAuth `state`, stores state/challenge with a five-minute expiry, and redirects to Discord authorization with `identify` scope and configured redirect URI. Callback rejects missing/expired/mismatched state, handles Discord cancellation, exchanges code using form-urlencoded POST to `https://discord.com/api/oauth2/token`, reads the user from `https://discord.com/api/users/@me`, and reads the JSON whitelist. A nonmember gets HTTP 403 HTML. A member receives a random 32-byte, 60-second one-time code mapped to profile and challenge, then a `p2pcast://auth/callback?code=...` redirect.

- [x] **Step 4: Implement desktop handoff verification and account endpoints**

  `POST /auth/exchange` validates `{code, verifier}` with Elysia TypeBox schema, consumes the code once, checks expiry, computes SHA-256 base64url and compares with the stored desktop handoff challenge, then signs a seven-day HS256 JWT with `sub`, `username`, nullable `avatar`, issuer `PUBLIC_URL`, and audience `p2p-cast-desktop` using `jose`. `GET /api/me` verifies a bearer JWT and returns that profile. `POST /api/logout` responds successfully without storing or changing server state; desktop removes the locally encrypted token. Add one Elysia error message for unauthorized/invalid exchange and never include OAuth secrets in responses.

- [x] **Step 5: Compose the backend and compile it**

  Register `@elysia/cors` for exact `APP_ORIGINS`, methods `GET,POST,OPTIONS`, headers `Authorization,Content-Type`, and `credentials:false`; mount auth routes, add `GET /health` returning `{ ok: true }`, and call `.listen(PORT)`. Run `bun install` then `bun run build`; fix TypeScript errors before moving on.

### Task 2: Add authenticated live-presence WebSocket

**Files:**

- Create: `backend/src/presence.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**

- `createPresenceRouter(config: BackendConfig, verifyToken: (token: string) => Promise<DiscordProfile | null>): Elysia` adds `WS /api/presence`.
- Client first frame: `{ "type": "auth", "token": "..." }`; subsequent frames are `{ "type": "live", "peerId": "...", "activity"?: "..." }` and `{ "type": "offline" }`.
- Server frames: `{ "type": "authenticated" }` followed by `{ "type": "presence", "users": LiveUser[] }`, where `LiveUser = { id, username, avatar, peerId, activity }`.

- [x] **Step 1: Add authenticated socket handling**

  Use Elysia's `.ws` route. Before a client can authenticate, compare `ws.data.headers.origin` against the exact `APP_ORIGINS` set and close with code 4403 if it is absent. Start a five-second auth timeout on open; parse frames as strings or JSON-like objects; verify bearer payload from the first auth frame; close with code 4401 on missing/invalid/late auth. After authorization, subscribe to the `presence` topic and immediately send the current live list.

- [x] **Step 2: Validate live messages and clean disconnected sockets**

  Limit `peerId` to 1–128 ASCII alphanumeric/underscore/hyphen characters and activity to 80 printable characters. Keep one presence record per socket, so multiple sessions for one Discord account may be live. On `live`, derive identity/profile only from the verified token; on `offline` or socket close, remove that socket's record.

- [x] **Step 3: Publish only active presence and compile the backend**

  Build a deduplicated current list by Discord ID, selecting the most recently updated active socket. Publish `{type:"presence",users}` to authenticated subscribers after each change. Add socket state maps and expiry cleanup without persistence. Run `bun run build` and resolve type errors.

### Task 3: Create the Electron host and single-window capture API

**Files:**

- Create: `desktop/package.json`
- Create: `desktop/src/main.cjs`
- Create: `desktop/src/preload.cjs`
- Create: `desktop/src/renderer.d.ts`
- Create: `desktop/scripts/dev.cjs`
- Create: `desktop/config.example.json`
- Create: `desktop/resources/.gitkeep`
- Create: `desktop/.gitignore`

**Interfaces:**

- `window.p2pcastDesktop.getWindowSources(): Promise<DesktopSource[]>` returns `{ id, name, thumbnailDataUrl }[]`.
- `window.p2pcastDesktop.selectWindow(sourceId: string): Promise<void>` sets the one window granted to the next `getDisplayMedia` call.
- `window.p2pcastDesktop.getConfig(): Promise<{ backendUrl: string; webUrl: string; appOrigin: "p2pcast-app://desktop"; isolatedAudioAvailable: boolean }>` returns configured API base, viewer website, and native support.
- Desktop `npm run dev`, `npm run build`, `npm run build:win` are available from `desktop/`.

- [x] **Step 1: Add Electron dependencies and scripts**

  Use Electron `^40.0.0` and electron-builder `^26.0.0`. The dev script starts the installed Vite CLI through Node with `--host 127.0.0.1`, waits until Vite responds, and launches Electron with `P2PCAST_RENDERER_URL`. Build runs the web production build then `electron-builder --dir`. Windows build first runs CMake for the helper and then packages NSIS. Include `src/**`, and copy `web/dist` plus `resources/` into `process.resourcesPath`.

- [x] **Step 2: Create secure BrowserWindow and Vite/package loading**

  Register `p2pcast-app` as a standard, secure, fetch-capable custom scheme before `app.whenReady`. Serve packaged `web/dist` files through `protocol.handle`, resolve every requested path under that directory, and return a Content-Security-Policy header that permits only self/data images, required PeerJS WebSocket traffic, and the configured API HTTP/WebSocket origins. Create a 1280×820 `BrowserWindow` with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `preload: path.join(__dirname,"preload.cjs")`. Load only the Vite URL in development or `p2pcast-app://desktop/index.html` when packaged. Deny renderer-created windows and open only HTTPS Discord/backend URLs through `shell.openExternal`.

- [x] **Step 3: Register protocol and Electron capture handler**

  Register `p2pcast` as the external auth callback scheme, process `open-url` on macOS and `second-instance` on Windows/Linux, and forward only a valid `auth/callback?code=` string to the renderer after the window exists. Set `setDisplayMediaRequestHandler` to enumerate `desktopCapturer.getSources({types:["window"],thumbnailSize:{width:320,height:180}})`, match only the previously selected source ID, and call back with `{video: selectedSource, audio:false}`. Never request `audio: "loopback"`.

- [x] **Step 4: Add preload bridge and dev script behavior**

  Expose only typed calls and event listeners with removable callbacks. Validate source ID strings before IPC. Add a dev process that kills its Vite child when Electron exits and propagates an early Vite startup error. Read `P2PCAST_BACKEND_URL`, otherwise `desktop/config.json`, otherwise default to `http://localhost:3001`; return it through `getConfig`.

### Task 4: Capture selected-process Windows audio

**Files:**

- Create: `desktop/native/windows/CMakeLists.txt`
- Create: `desktop/native/windows/process-audio.cpp`
- Modify: `desktop/src/main.cjs`
- Modify: `desktop/src/preload.cjs`
- Modify: `desktop/src/renderer.d.ts`

**Interfaces:**

- `window.p2pcastDesktop.startApplicationAudio(sourceId): Promise<{ captureId: string, format: { sampleRate: 48000, channels: 2, format: "f32le" } }>` starts the process loopback for the source window.
- `window.p2pcastDesktop.resumeApplicationAudio(captureId): Promise<void>` resumes PCM delivery after the renderer installs its audio listeners.
- `window.p2pcastDesktop.onApplicationAudioData(captureId, listener): () => void` receives aligned interleaved Float32LE PCM chunks.
- `window.p2pcastDesktop.onApplicationAudioError(captureId, listener): () => void` reports a helper exit after capture starts.
- `window.p2pcastDesktop.stopApplicationAudio(captureId): Promise<void>` terminates the matching helper.
- The helper accepts one HWND in base-10 command-line form and writes a JSON format line followed by stereo 48 kHz Float32LE PCM to stdout.

- [x] **Step 1: Resolve selected HWND to process and activate WASAPI process loopback**

  Parse Electron source IDs in the main process as `window:<handle>:...`, validate the numeric/hex handle, and pass it as an argument to the helper. The helper resolves the window PID with `GetWindowThreadProcessId`, activates `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` using `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` and `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`, then initializes a 48 kHz two-channel float shared capture stream with `AUDCLNT_STREAMFLAGS_LOOPBACK`, `AUDCLNT_STREAMFLAGS_EVENTCALLBACK`, and `AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM`.

- [x] **Step 2: Emit well-formed PCM and native startup errors**

  Write `{"sampleRate":48000,"channels":2,"format":"f32le"}\n` before samples. Read each `IAudioCaptureClient` packet; emit zeroes for silent packets and copy only complete interleaved stereo frames. Send startup diagnostics to stderr, return nonzero on COM/WASAPI errors, and exit when stdout closes or the process is terminated.

- [x] **Step 3: Add CMake and Electron helper process lifecycle**

  Compile with C++17 and link `ole32`, `uuid`, `mmdevapi`, and `avrt`. IPC spawns the helper with `windowsHide: true`, buffers stdout through the metadata newline, emits complete byte chunks to only the requesting renderer, and reports stderr/exit errors. Retain a per-window capture map, enforce one helper per capture ID, and kill helpers on explicit stop, renderer destruction, app quit, or startup timeout. Unknown platforms respond `isolatedAudioAvailable:false` and reject a helper start.

- [x] **Step 4: Wire packaged resource paths and build platform availability**

  `build:win` copies the Release helper to `desktop/resources/p2pcast-process-audio.exe`; NSIS resources include that file. Non-Windows `build` packages the app without the helper and does not expose application-audio capture as supported. Run `cmake --build` only on Windows; on this Linux/Termux host, inspect CMake/source integration without attempting a Windows cross-build.

### Task 5: Integrate desktop window capture into the existing stream flow

**Files:**

- Create: `web/src/lib/desktop.ts`
- Create: `web/src/vite-env.d.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/index.css`

**Interfaces:**

- `isDesktopApp(): boolean` detects `window.p2pcastDesktop`.
- `listDesktopWindows(): Promise<DesktopWindow[]>` returns source ID/title/thumbnail.
- `captureDesktopWindow(sourceId: string, settings: CaptureSettings): Promise<MediaStream>` captures exactly one video window and optionally adds isolated application audio. It must stop video/context/helper if setup fails.
- `HomeView` receives `selectedWindowId`, `onWindowChange`, and `onStart(settings, selectedWindowId?)`.

- [x] **Step 1: Implement desktop window listing and capture wrapper**

  Query Electron source data through preload. Before capture, call `selectWindow(sourceId)` and `getDisplayMedia` with existing width/height/FPS constraints and `audio:false`. If `settings.audio` is true and isolated audio is available, start WASAPI and use `AudioContext.createBuffer`/`AudioBufferSourceNode` with sample rate 48000 and deinterleaved channel data to produce an audio track through `createMediaStreamDestination`. Schedule PCM buffers consecutively from `max(context.currentTime + 0.02, nextPlaybackTime)`. If not supported or helper startup fails, reject with a clear error; never use system audio.

- [x] **Step 2: Show and refresh the selected-window picker**

  In desktop mode, show a select control with each window title and thumbnail; refresh the list on entry and provide a refresh action. Disable start until one source exists. Show the selected-window audio option only when preload reports Windows helper availability. Otherwise force the persisted audio choice off and show the concise text that isolated application audio is currently available on Windows only.

- [x] **Step 3: Reuse the existing P2P lifecycle and cleanup**

  Extend the broadcaster start callback with optional selected source ID. For desktop screen capture call `captureDesktopWindow`; for web and camera/both preserve current acquisition paths. Store the resulting stream in the existing `screen` slot so PeerJS viewer metadata/source stays unchanged. Add `releaseDesktopCapture(stream)` to the existing stop path so manual stop closes AudioContext and terminates the helper even when `MediaStreamTrack.stop()` does not emit `ended`. Ensure the capture wrapper itself cleans up partial failures.

- [x] **Step 4: Add desktop and web compile checks**

  Add only CSS for the picker/account/presence controls; keep mobile web layout intact. Run `npm --prefix web run build`; resolve errors before authentication UI is added.

### Task 6: Add encrypted Discord session, presence UI and friend viewing

**Files:**

- Modify: `desktop/src/main.cjs`
- Modify: `desktop/src/preload.cjs`
- Modify: `desktop/src/renderer.d.ts`
- Modify: `web/src/lib/desktop.ts`
- Create: `web/src/lib/desktop-account.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/index.css`

**Interfaces:**

- `window.p2pcastDesktop.loginWithDiscord(codeChallenge: string): Promise<void>` opens `${backendUrl}/auth/discord?code_challenge=...` externally.
- `window.p2pcastDesktop.getSavedSession(): Promise<{token:string,user:DiscordProfile}|null>` decrypts the safeStorage value in main.
- `window.p2pcastDesktop.saveSession(session): Promise<void>` encrypts it; `clearSession(): Promise<void>` removes it.
- `getLoginVerifier(): Promise<string|null>`, `saveLoginVerifier(verifier): Promise<void>`, and `clearLoginVerifier(): Promise<void>` keep the desktop handoff proof encrypted for no more than ten minutes.
- `useDesktopAccount()` returns `{ user, liveUsers, error, signIn, signOut, setLivePeer(peerId|null), watch(peerId) }` and owns auth exchange plus presence socket.

- [x] **Step 1: Add safeStorage-backed session IPC and login handoff challenge**

  Add IPC methods to start OAuth, read/encrypt/delete a session file and short-lived verifier under `app.getPath("userData")`, and forward auth deep links. Main process uses Electron `safeStorage` and never returns the encryption key. Renderer creates a 32-byte verifier with `crypto.getRandomValues`, computes its SHA-256 challenge with Web Crypto, saves the verifier encrypted, and starts OAuth with the challenge. Keep a preload-side queue for callbacks received before React subscribes.

- [x] **Step 2: Redeem callback codes and manage presence WebSocket**

  In `useDesktopAccount`, subscribe to auth deep links; POST `{code,verifier}` to `/auth/exchange`; clear verifier after success/failure; store token/user through IPC. Rehydrate using `getSavedSession`, validate with `/api/me`, and discard stale sessions. Connect `wss:` for HTTPS API or `ws:` for HTTP API, send `{type:"auth",token}` first, wait for `{type:"authenticated"}`, then send the current `{type:"live",peerId}` if one exists. Update `liveUsers` from presence frames and send `{type:"offline"}` when PeerJS stops. On failure, reconnect after 1, 2, 4, 8, 16 and 30 seconds; never block media setup.

- [x] **Step 3: Display account controls and live users**

  Add Discord sign-in button and authenticated username/avatar plus sign-out control to the desktop home. Render live-user entries from backend presence with a watch action; watch action navigates to current app path with existing `?watch=<peerId>` query parameter. Add optional activity label. If a user is anonymous, show login as an optional presence enhancement and keep the start button usable.

- [x] **Step 4: Connect presence to live lifecycle and preserve cleanup**

  Share the account controller with `BroadcastView`. After PeerJS opens and returns its room ID call `setLivePeer(id)`; call `setLivePeer(null)` before destroying the peer and on component unmount. If login finishes during an active live, publish the current ID immediately after presence authentication. Viewer mode does not publish live status.

- [x] **Step 5: Build web and desktop**

  Run the web production build and syntax checks for Electron scripts. Electron packaging and the native Windows helper require a supported desktop build host.

### Task 7: Document local setup, OAuth deployment and Windows packaging

**Files:**

- Create: `README.md`
- Modify: `backend/.env.example`
- Modify: `desktop/config.example.json`
- Modify: `desktop/package.json`

**Interfaces:**

- Documentation lists required command order and matching Discord redirect URI.
- Backend docs state whitelist entries are numeric Discord IDs and that active presence is volatile.
- Desktop docs explain the Windows SDK/CMake prerequisite and that audio capture never falls back to global system audio.

- [x] **Step 1: Document initial setup and local development**

  Document `bun install && bun run dev` in `backend/`, `npm install && npm run dev` in `web/`, and `npm install && npm run dev` in `desktop/`. Explain that anonymous P2P broadcast remains available while backend config is unset.

- [x] **Step 2: Document Discord and whitelist configuration**

  Explain adding `DISCORD_REDIRECT_URI` to the Discord OAuth application, copying `backend/.env.example` to `.env`, setting `JWT_SECRET` to 32+ random characters, copying `backend/whitelist.example.json` to `backend/whitelist.json` and entering Discord user IDs there, then creating Electron's `config.json` under its user data folder with public HTTPS `backendUrl` and the hosted React viewer `webUrl`.

- [x] **Step 3: Document supported audio and release commands**

  Document Windows 10 build 20348+ with Visual Studio C++ Build Tools/Windows SDK/CMake, then `npm run build:win`; document generic `npm run build` and non-Windows window video-only audio. Explain Linux PipeWire may return only the desktop capture source through Electron and app audio remains disabled.

- [x] **Step 4: Perform final build review**

  Run `bun run build` in backend, `npm --prefix web run build`, `node --check` on Electron scripts, and `git diff --check`. Do not run automated tests. Inspect final diff to ensure the pre-existing Android edits remain untouched; record Electron packaging and Windows helper compilation as unverified when running from Android/Termux.
