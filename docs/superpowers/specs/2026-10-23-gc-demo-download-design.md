# GC Demo Download: design

## Intent

Make the GC match-page button hand the demo download URL to P2P-Cast so the app owns the download, temporary storage, playback handoff, and retention cleanup. Add usable diagnostics in both the extension and app to locate future failures.

## Goals

- Capture the `.dem` download URL started by the GC match-page action and send it to the localhost P2P-Cast listener.
- Cancel Chrome's copy once the URL is captured; P2P-Cast streams the demo to its cache folder and opens that local file in CS2, launching CS2 through Steam when necessary.
- Keep a local JSON manifest with each stored demo's filename, match ID, and completion time. Remove entries and files after 24 hours, sweeping on startup and every 15 minutes.
- Record redacted flow events in the extension and P2P-Cast. Let the user export or clear extension logs; retain the app's existing `p2pcast.log` rotation.
- Publish a signed Windows OTA release after building on the current Windows workspace, as requested.

## Non-goals and constraints

- Do not create a separate helper executable or require moving demos into the CS2 install directory.
- Keep the listener bound to `127.0.0.1:43172`; require the Gamers Club origin and loopback Host header.
- Do not persist or log GC cookies, signed download URLs, or full local paths. Cookies may be forwarded in-memory to the app for an authenticated GC download.
- Keep the unpacked extension in its existing folder; Chrome may require manually reloading it after the source changes.

## Approaches

- **Pass the GC URL to P2P-Cast (selected by the request):** Chrome reports the download URL, the extension cancels the browser transfer, and the app streams it to its own temporary folder. This centralizes file ownership and expiry cleanup in the app.
- **Download in Chrome and copy the result:** simpler network behavior, but retains the Chrome-download correlation that left the earlier flow stuck and creates duplicate file handling.

## Implementation decisions

- Extend the existing listener with `POST /v1/download-demo`; retain `POST /v1/playdemo` for compatibility.
- Use a streaming HTTPS client in Rust, follow only a bounded number of HTTPS redirects, and never forward cookies after the original host changes.
- Store demo files and `demos.json` in Tauri's app cache directory under `gc-demos`.
- Keep at most 500 extension log events in `chrome.storage.local`; expose a popup that exports the log as JSON and can clear it.
- Bump the synchronized desktop version to 0.4.8 and publish `desktop-v0.4.8` with the existing updater release script.
