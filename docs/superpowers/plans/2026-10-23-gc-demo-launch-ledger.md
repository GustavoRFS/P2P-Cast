# GC Demo Launcher execution ledger

- Task 1: Updated the service worker to use exact match referrers first, a unique-pending fallback only when referrer data is absent, clear ambiguous requests with errors, and handle interrupted/completed download state. `node --check extension/service-worker.js` passed. No test suite was added or run.
- Task 2: Added Steam URI launch with a two-minute visible-window wait, plus listener/request logs that omit the demo path. `rustfmt --edition 2021 --check src/demo_launcher.rs` passed. The workspace-wide `cargo fmt --check` returned exit 1 because existing unrelated files are not formatted by the current rustfmt; no unrelated files were changed.
- Ruling: Keep pre-existing repository formatting untouched — the whole-crate formatter reports changes in unrelated files, while the edited Rust file passes its own formatter check — cost if wrong: unrelated formatting differences remain in the repository.
- Task 3: Synchronized the desktop package, package lock, Cargo manifest/lock, and Tauri config to 0.4.7. JSON parsing and `git diff --check` passed. Windows release build, OTA publication, and extension reload handoff remain.
