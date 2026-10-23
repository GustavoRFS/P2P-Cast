# GC Demo Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move GC demo downloads into P2P-Cast, retain them for 24 hours, add exportable extension diagnostics and detailed app logs, and publish OTA 0.4.8.

**Architecture:** The MV3 service worker correlates the GC-created `.dem` download, captures its HTTPS URL and GC cookies, cancels Chrome's transfer, then sends the request through the existing content-script bridge. The Tauri loopback listener downloads the file into `app_cache_dir()/gc-demos`, records it in `demos.json`, expires files after 24 hours, and passes the stored absolute path to the existing CS2 launcher.

**Tech Stack:** Chrome MV3 APIs, Rust/Tauri 2, `reqwest` blocking + rustls streaming, `serde_json`, existing `p2pcast.log` logger, GitHub CLI release script.

**Spec:** `docs/superpowers/specs/2026-10-23-gc-demo-download-design.md`

## Global Constraints

- Bind only to `127.0.0.1:43172`; accept browser requests only from `https://gamersclub.com.br` and the expected loopback Host.
- Keep cookies and signed URLs in memory only; redact them from extension and app logs.
- Store completed demos and the JSON manifest under the app cache's `gc-demos` directory.
- Expire completed files 24 hours after download completion; run cleanup at startup and every 15 minutes.
- Build on this Windows workspace and publish the signed `desktop-v0.4.8` OTA release.
- Preserve the existing untracked `backend/bun.lock`.

## Review Focus

- Missing or ambiguous download correlation must report an actionable extension error and must not guess which match owns a URL.
- Invalid, non-HTTPS, or redirect-loop URLs must fail without writing a completed demo or forwarding cookies to a different host.
- GC authentication failures must leave no completed file and must not expose cookie values or the signed URL in logs.
- Invalid manifest entries, missing files, and files that cannot be deleted must not cause deletion outside `gc-demos`; failed deletions remain eligible for a later sweep.
- Expiration is measured from completion, so a download lasting over a day is not deleted mid-transfer.

## File Map

- `extension/manifest.json`: required cookie/local-host permissions and popup entry.
- `extension/service-worker.js`: redacted ring-buffer logging, download URL correlation, cancellation, and extension-to-page message.
- `extension/content.js`: user status, logging bridge, and POST to the app endpoint.
- `extension/popup.html`, `extension/popup.js`: inspect/export/clear the extension log buffer.
- `desktop-tauri/src-tauri/src/demo_launcher.rs`: request validation, listener route, streaming download, CS2 launch, and flow logging.
- `desktop-tauri/src-tauri/src/demo_download.rs`: HTTPS URL validation, redirects, DNS pinning, and streaming into a partial file.
- `desktop-tauri/src-tauri/src/demo_storage.rs`: temporary-folder manifest and 24-hour cleanup.
- `desktop-tauri/src-tauri/src/lib.rs`: initialize storage/listener and periodic cleanup.
- `desktop-tauri/src-tauri/Cargo.toml`, `Cargo.lock`: HTTPS streaming dependency.
- Desktop package/Tauri version files and docs: synchronize 0.4.8 and release notes.

---

### Task 1: Extension URL handoff and diagnostics

**Files:** modify `extension/manifest.json`, `extension/service-worker.js`, `extension/content.js`; create `extension/popup.html` and `extension/popup.js`.

**Interfaces:** the service worker sends `{type: "downloadDemo", url, matchId, cookies, requestId}` to the GC tab; content sends `POST /v1/download-demo` with JSON `{url, matchId, cookies}`.

- [x] Replace completion/path correlation with early URL capture for a unique pending GC match request; support `.dem` and `.dem.crdownload` names.
- [x] Read cookies only for the GC download host, cancel the browser download, and send the URL + in-memory cookies to the content script. Log URL host and match ID only.
- [x] Add a 500-entry redacted `chrome.storage.local` log buffer and log arming, URL capture, cancel, app handoff, response, and failures.
- [x] Add popup controls to export the stored log as JSON and clear it; verify all extension scripts with `node --check`.

### Task 2: P2P-Cast download, storage, expiry, and diagnostics

**Files:** create `desktop-tauri/src-tauri/src/demo_storage.rs` and `demo_download.rs`; modify `desktop-tauri/src-tauri/src/demo_launcher.rs`, `desktop-tauri/src-tauri/src/lib.rs`, and Rust dependencies.

**Interfaces:** `DemoStorage::new(cache_dir: PathBuf) -> Result<DemoStorage, String>`, `DemoStorage::cleanup_expired() -> Result<usize, String>`, `DemoStorage::store_completed(partial_path: &Path, completed_path: &Path, match_id: &str) -> Result<PathBuf, String>`; listener route `POST /v1/download-demo` accepts `{url, matchId, cookies}`.

- [x] Add the HTTPS client dependency and raise the bounded JSON-body limit enough for a GC cookie header; return the private-network CORS header for the GC origin.
- [x] Implement JSON manifest load/write, generated safe `.dem` filenames, 24-hour expiry from completion, startup cleanup, and a 15-minute cleanup loop. Keep all deletions constrained to the cache subfolder.
- [x] Add `/v1/download-demo`, validate HTTPS URLs and bounded redirects, redact sensitive values, stream response bytes to a `.part` file, atomically finalize/record the demo, then call the existing `open_demo` flow.
- [x] Spawn a request worker per accepted connection so a long demo download does not block the listener; log request stages and cleanup counts without paths or credentials.
- [x] Run `cargo fmt --check` on touched Rust files and build the Windows NSIS bundle.

### Task 3: Version and OTA release

**Files:** update `desktop-tauri/src-tauri/tauri.conf.json`, Cargo/package version declarations and lock entries, plus the release documentation.

- [x] Synchronize the desktop version to `0.4.8` and prepare release notes describing app-managed demo download, 24-hour cleanup, and diagnostics.
- [ ] Commit the P2P-Cast changes, push the containing commit, and run the existing release script from this Windows workspace to publish the signed `desktop-v0.4.8` release and `latest.json`.
- [ ] Verify the published tag, installer/signature assets, and updater feed version; leave the separate unpacked extension source ready for Chrome's manual Reload action.
