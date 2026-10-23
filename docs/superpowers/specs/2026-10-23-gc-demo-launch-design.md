# GC Demo Launcher: design

## Intent

Make the Gamers Club extension's one-click download flow open its `.dem` in CS2, including when the game is closed, and report completion or failure instead of leaving the page stuck at “Download iniciado”. The bridge remains the loopback listener inside P2P-Cast Tauri; there is no separate helper program.

## Goals

- Correlate a completed `.dem` with the extension request armed by the GC match page. Prefer exact match-page referrer; if the browser omits it, use a recent request only when exactly one candidate exists.
- If CS2 has no visible window, ask Steam to launch app 730, wait up to two minutes for a visible CS2 window, then focus it and send `playdemo "<absolute path>"`.
- Return clear errors for ambiguous downloads, Steam launch failures, missing CS2 windows, or rejected keyboard input; log listener startup and request outcomes in `p2pcast.log` without logging the full local file path.
- Bump the desktop updater to 0.4.7 and publish its signed Windows installer and updater feed.

## Non-goals and constraints

- Keep the current extension + P2P-Cast architecture and the localhost-only listener on port 43172.
- Preserve strict GC Origin/Host checks and absolute `.dem` path validation.
- Do not move the downloaded demo or add a separate executable.
- The unpacked Chrome extension must be manually reloaded after its local files change because automated access to `chrome://extensions` is blocked.

## Approaches

- **Require CS2 to be open:** simplest, but keeps a manual step and fails the intended one-click flow when the game is closed.
- **Launch CS2 through Steam from P2P-Cast (chosen):** reuses the existing listener and the Steam URI behavior already used to launch CS2; waits for its window before sending the console command. This matches the requested flow while keeping OS launching inside the existing Tauri app.

## Implementation scope

Update `extension/service-worker.js` to match a recent download safely when referrer metadata is absent and to complete the page status lifecycle. Update `desktop-tauri/src-tauri/src/demo_launcher.rs` to launch/wait/log and `Cargo.toml` for any required Windows API feature. Bump synchronized package, Cargo, lockfile, and Tauri versions to 0.4.7.

## Failure behavior

If Steam cannot launch CS2 or no visible window appears within two minutes, return a clear error to the match page and re-enable its button. If multiple pending requests could match a download without usable referrer data, do not guess; report that the request could not be matched.
