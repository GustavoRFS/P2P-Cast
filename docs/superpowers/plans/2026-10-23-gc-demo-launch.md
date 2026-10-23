# GC Demo Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GC extension report download completion and open the downloaded demo in CS2, launching CS2 automatically when it is closed.

**Architecture:** Keep the extension-to-loopback-listener flow on port 43172. The extension correlates Chrome's completed `.dem` download with the armed match-page request; P2P-Cast validates the absolute path, starts CS2 through Steam if needed, waits up to two minutes for a visible game window, and sends the console command. Publish the updated signed desktop build through the existing OTA release flow.

**Tech Stack:** Chrome Manifest V3 extension, Rust/Windows APIs, Tauri updater, existing GitHub release script.

**Spec:** `docs/superpowers/specs/2026-10-23-gc-demo-launch-design.md`

## Global Constraints

- Keep the existing extension plus P2P-Cast Tauri architecture and localhost listener on port 43172.
- Preserve strict GC Origin/Host checks and absolute `.dem` path validation.
- Do not move the downloaded demo or add a separate executable.
- Launch CS2 using the Steam app 730 URI and wait at most two minutes for its visible window.
- Do not log the full local demo path.
- Preserve the pre-existing untracked `backend/bun.lock`; do not include it in release changes.
- Build the Windows app on `ligma`, as required by `AGENTS.md`.
- Do not add or run test suites under the current instruction; use source review and the required release build for verification.

## Review Focus

- A request armed before the download with an exact GC match referrer must be the one associated with that `.dem`.
- When referrer metadata is absent, only one eligible pending request may be associated; ambiguity must fail the pending requests without guessing.
- Interrupted downloads and P2P errors must show an error and re-enable the GC page button.
- Steam accepting the URI without CS2 producing a visible window within two minutes must become a clear error.
- An already-open CS2 window must continue through the existing focus and console input path without invoking Steam.

---

### Task 1: Correlate the GC download and finish page status

**Files:**
- Modify: `../gc-watch-demo/extension/service-worker.js`

**Interfaces:**
- Consumes: `armDemoDownload` requests from `content.js`, keyed by tab ID with `pageUrl`, `armedAt`, and `requestId`.
- Produces: `demoStatus` and `playDemo` messages to the same tab, preserving the request ID.

- [x] Keep exact match-ID referrer matching as the first choice, and use the recent pending request fallback only when the download has no referrer and exactly one request is eligible by `startTime` and the five-minute TTL.
- [x] On ambiguous unmatched `.dem` downloads, clear the competing pending entries and send each tab a clear matching error so the page can re-enable its button; do not associate the file with any request.
- [x] Preserve the complete and interrupted paths: a matched completed download sends its absolute filename once to the content script, while an interrupted or unopenable download returns an error status and clears the tracked entry.
- [x] Review the created/changed event ordering and request-ID checks in source; do not add or run an automated test suite. `node --check extension/service-worker.js` passed.

### Task 2: Launch CS2 through Steam and log listener outcomes

**Files:**
- Modify: `desktop-tauri/src-tauri/src/demo_launcher.rs`
- Modify: `desktop-tauri/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: the existing validated absolute path from `POST /v1/playdemo`.
- Produces: the existing success/error JSON response consumed by `content.js`.

- [x] Add the Windows Shell API feature needed to launch `steam://rungameid/730` with `ShellExecuteW`; treat a ShellExecute result of 32 or lower as a launch error.
- [x] In `open_demo`, retain `validate_demo_path`; use an existing CS2 window immediately, otherwise request Steam launch and poll once per second for a visible CS2 window for at most two minutes.
- [x] Return a clear timeout or launch error to the extension, then keep the existing focus, console, and `playdemo "<absolute path>"` input sequence.
- [x] Add `log::info!` records for listener startup and request success/failure, without including the full local path; use the existing app logger target filter.
- [x] Review the control flow and run `rustfmt --edition 2021 --check src/demo_launcher.rs` after implementation; do not run tests. The whole-crate `cargo fmt --check` also reports pre-existing formatting diffs in unrelated Rust files.

### Task 3: Version and publish the OTA update

**Files:**
- Modify: `desktop-tauri/package.json`
- Modify: `desktop-tauri/package-lock.json`
- Modify: `desktop-tauri/src-tauri/Cargo.toml`
- Modify: `desktop-tauri/src-tauri/Cargo.lock`
- Modify: `desktop-tauri/src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: the existing signing environment and `desktop-tauri/scripts/release.mjs` release procedure.
- Produces: signed version 0.4.7 installer and updater metadata in the latest GitHub release.

- [x] Set all desktop app version declarations to `0.4.7` and synchronize the Cargo root package lock entry.
- [x] Build and publish the signed Windows installer and `latest.json` using the existing release script on `ligma`; inspect the published release assets and version before considering the OTA step complete. `desktop-v0.4.7` is public and the latest feed reports version `0.4.7`.
- [x] Keep `backend/bun.lock` unstaged and outside the release commit.
- [x] Confirm the local unpacked extension source is updated. Chrome still needs a manual reload of the unpacked extension for the new service worker to take effect.
