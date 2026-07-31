#!/usr/bin/env bash
#
# release-all.sh — Build and publish releases for macOS, Windows, and Linux.
#
# Usage:
#   ./scripts/release-all.sh          # Build all platforms
#   ./scripts/release-all.sh mac      # macOS only (signed + notarized)
#   ./scripts/release-all.sh win      # Windows only
#   ./scripts/release-all.sh linux    # Linux only
#
# Requirements:
#   - AWS CLI configured with write access to s3://archigraph-releases-prod
#   - For macOS: Apple Developer ID cert + notarization credentials in Keychain
#
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────
S3_BUCKET="archigraph-releases-prod"
S3_PREFIX="draftdown"
VERSION="1.0.0"

DMG_INTEL="DraftDown-${VERSION}.dmg"
DMG_ARM64="DraftDown-${VERSION}-arm64.dmg"
WIN_INSTALLER="DraftDown Setup ${VERSION}.exe"
LINUX_APPIMAGE="DraftDown-${VERSION}.AppImage"

KEYCHAIN_PROFILE="sketchcraft-notary"

# ─── Helpers ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

say() { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
die() { printf "\033[1;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

PLATFORMS="${1:-all}"

# ─── Preflight ───────────────────────────────────────────────────────────
say "Checking prerequisites"
command -v aws >/dev/null || die "aws CLI not found"
aws sts get-caller-identity >/dev/null 2>&1 || die "AWS CLI not authenticated"

if [[ "$PLATFORMS" == "all" || "$PLATFORMS" == "mac" ]]; then
  command -v xcrun >/dev/null || die "xcrun not found (install Xcode Command Line Tools)"
  security find-identity -v -p codesigning | grep -q "Developer ID Application" \
    || die "No Developer ID Application signing identity found in Keychain"
  xcrun notarytool history --keychain-profile "$KEYCHAIN_PROFILE" >/dev/null 2>&1 \
    || die "Keychain profile '$KEYCHAIN_PROFILE' not found"
fi

# ─── Build ───────────────────────────────────────────────────────────────
say "Building application"
npm run build

build_mac() {
  say "Building macOS (x64 + arm64, signed + notarized)"
  export APPLE_KEYCHAIN_PROFILE="$KEYCHAIN_PROFILE"
  npx electron-builder --mac --x64 --arm64

  say "Verifying macOS signatures"
  codesign --verify --deep --strict --verbose=2 "$ROOT/release/mac/DraftDown.app" 2>&1 | tail -2
  codesign --verify --deep --strict --verbose=2 "$ROOT/release/mac-arm64/DraftDown.app" 2>&1 | tail -2

  say "Uploading macOS DMGs"
  aws s3 cp "$ROOT/release/$DMG_INTEL" "s3://$S3_BUCKET/$S3_PREFIX/$DMG_INTEL" \
    --content-type "application/x-apple-diskimage"
  aws s3 cp "$ROOT/release/$DMG_ARM64" "s3://$S3_BUCKET/$S3_PREFIX/$DMG_ARM64" \
    --content-type "application/x-apple-diskimage"
}

build_win() {
  say "Building Windows (x64 NSIS installer)"
  npx electron-builder --win --x64

  say "Uploading Windows installer"
  aws s3 cp "$ROOT/release/$WIN_INSTALLER" "s3://$S3_BUCKET/$S3_PREFIX/$WIN_INSTALLER" \
    --content-type "application/x-executable"
}

build_linux() {
  say "Building Linux (x64 AppImage)"
  npx electron-builder --linux --x64

  say "Uploading Linux AppImage"
  aws s3 cp "$ROOT/release/$LINUX_APPIMAGE" "s3://$S3_BUCKET/$S3_PREFIX/$LINUX_APPIMAGE" \
    --content-type "application/x-executable"
}

case "$PLATFORMS" in
  all)
    build_mac
    build_win
    build_linux
    ;;
  mac)   build_mac ;;
  win)   build_win ;;
  linux) build_linux ;;
  *)     die "Unknown platform: $PLATFORMS (use: all, mac, win, linux)" ;;
esac

# ─── Summary ─────────────────────────────────────────────────────────────
BASE_URL="https://$S3_BUCKET.s3.us-east-1.amazonaws.com/$S3_PREFIX"

cat <<EOF

$(printf "\033[1;32m✓ Release published\033[0m")

  macOS (Apple Silicon):  $BASE_URL/$DMG_ARM64
  macOS (Intel):          $BASE_URL/$DMG_INTEL
  Windows (x64):          $BASE_URL/$(echo "$WIN_INSTALLER" | sed 's/ /%20/g')
  Linux (x64):            $BASE_URL/$LINUX_APPIMAGE

EOF
