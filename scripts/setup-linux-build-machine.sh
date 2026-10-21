#!/usr/bin/env bash
# Sets up a Linux box (the `ssh ligma` one) to build every P2P-Cast release without sudo: the Android
# APK, the Windows desktop installer (cross-compiled with cargo-xwin) and an Android emulator for
# tests. Needs git, node/npm, curl, unzip, clang/clang-cl, llvm-lib and llvm-rc already installed,
# a JDK 17+ (JAVA_HOME below) and an Android SDK with cmdline-tools (ANDROID_HOME below).
# Afterwards: `source ~/.p2pcast-build-env`, then `npm run release:android -- --no-publish` in
# app-react-native and `npm run release -- --no-publish` in desktop-tauri. The signing keys are
# not created here: copy ~/.android/p2pcast-release.{jks,properties} and ~/.tauri/p2p-cast-updater.key.
set -euo pipefail

JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk-21.0.12.1+1}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
NSIS_VERSION="3.12-1"
mkdir -p "$HOME/opt" "$HOME/.local/bin"

cat > "$HOME/.p2pcast-build-env" <<EOF
# Build environment for P2P-Cast releases on this Linux box (source it before releasing).
export JAVA_HOME="$JAVA_HOME"
export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export NSISDIR="\$HOME/opt/nsis/usr/share/nsis"
export PATH="\$JAVA_HOME/bin:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator:\$HOME/.cargo/bin:\$HOME/.local/bin:\$HOME/opt/nsis/usr/bin:\$PATH"
EOF
# shellcheck disable=SC1091
source "$HOME/.p2pcast-build-env"

# EAS CLI, for `eas update` (log in once with `eas login`).
npm install -g eas-cli@latest --no-audit --no-fund
command -v mise > /dev/null && mise reshim || true

# Rust with the Windows MSVC target and cargo-xwin, which fetches the MSVC CRT and Windows SDK.
if [ ! -x "$HOME/.cargo/bin/rustup" ]; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
fi
rustup toolchain install stable --profile minimal
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
# lld picks its flavor from argv[0]: rust-lld called as lld-link is the MSVC-style linker.
ln -sf "$(rustc --print sysroot)/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld" "$HOME/.local/bin/lld-link"

# makensis: Debian's build and data unpacked under ~/opt/nsis. Tauri runs it without the caller's
# NSISDIR, so a wrapper earlier on PATH sets it.
work="$(mktemp -d)"
for deb in "nsis_${NSIS_VERSION}_amd64.deb" "nsis-common_${NSIS_VERSION}_all.deb"; do
    curl -sSfL -o "$work/$deb" "https://deb.debian.org/debian/pool/main/n/nsis/$deb"
done
rm -rf "$HOME/opt/nsis" && mkdir -p "$HOME/opt/nsis"
for deb in "$work"/*.deb; do
    (cd "$work" && ar x "$deb" && tar -xf data.tar.* -C "$HOME/opt/nsis" && rm -f data.tar.* control.tar.* debian-binary)
done
rm -rf "$work"
cat > "$HOME/.local/bin/makensis" <<EOF
#!/bin/sh
NSISDIR="$HOME/opt/nsis/usr/share/nsis" exec "$HOME/opt/nsis/usr/bin/makensis" "\$@"
EOF
chmod +x "$HOME/.local/bin/makensis"

# Android emulator for tests. The release APK is arm64-only and does not start on an x86_64
# emulator (React Native's SoLoader looks for the device's primary ABI), so test builds add x86_64:
# `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64` in app-react-native/android.
yes | sdkmanager --licenses > /dev/null || true
sdkmanager --install "emulator" "platform-tools" "system-images;android-35;google_apis;x86_64"
echo "no" | avdmanager create avd --force --name p2pcast-test \
    --package "system-images;android-35;google_apis;x86_64" --device "pixel_7"

echo "Done. Run headless: emulator -avd p2pcast-test -no-window -no-audio -gpu swiftshader_indirect"
