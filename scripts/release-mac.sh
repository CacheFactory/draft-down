#!/usr/bin/env bash
#
# release-mac.sh — Build, sign, notarize, and publish macOS DMGs.
#
# Usage:
#   ./scripts/release-mac.sh
#
# Requirements:
#   - Apple Developer ID Application cert in Keychain
#   - Notarization credentials stored in Keychain via:
#       xcrun notarytool store-credentials "draftdown-notary" \
#         --apple-id "<email>" --team-id "6W2A7VS4U3"
#   - AWS CLI configured with write access to s3://archigraph-releases-prod
#
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────
S3_BUCKET="archigraph-releases-prod"
S3_PREFIX="draftdown"
DMG_INTEL="DraftDown-1.0.0.dmg"
DMG_ARM64="DraftDown-1.0.0-arm64.dmg"
KEYCHAIN_PROFILE="sketchcraft-notary"

# ─── Helpers ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

say() { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
die() { printf "\033[1;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

# ─── Preflight checks ────────────────────────────────────────────────────
say "Checking prerequisites"

command -v aws >/dev/null || die "aws CLI not found"
command -v xcrun >/dev/null || die "xcrun not found (install Xcode Command Line Tools)"

security find-identity -v -p codesigning | grep -q "Developer ID Application" \
  || die "No Developer ID Application signing identity found in Keychain"

xcrun notarytool history --keychain-profile "$KEYCHAIN_PROFILE" >/dev/null 2>&1 \
  || die "Keychain profile '$KEYCHAIN_PROFILE' not found. Run:
  xcrun notarytool store-credentials \"$KEYCHAIN_PROFILE\" \\
    --apple-id \"<your-apple-id>\" --team-id \"6W2A7VS4U3\""

aws sts get-caller-identity >/dev/null 2>&1 \
  || die "AWS CLI not authenticated"

# ─── Build ───────────────────────────────────────────────────────────────
say "Building signed + notarized DMGs (x64 + arm64)"
export APPLE_KEYCHAIN_PROFILE="$KEYCHAIN_PROFILE"
npm run dist:mac

# ─── Verify outputs ──────────────────────────────────────────────────────
INTEL_PATH="$ROOT/release/$DMG_INTEL"
ARM64_PATH="$ROOT/release/$DMG_ARM64"

[ -f "$INTEL_PATH" ] || die "Missing build output: $INTEL_PATH"
[ -f "$ARM64_PATH" ] || die "Missing build output: $ARM64_PATH"

say "Verifying signatures"
codesign --verify --deep --strict --verbose=2 "$ROOT/release/mac/DraftDown.app" 2>&1 | tail -2
codesign --verify --deep --strict --verbose=2 "$ROOT/release/mac-arm64/DraftDown.app" 2>&1 | tail -2

# ─── Upload ──────────────────────────────────────────────────────────────
say "Uploading to s3://$S3_BUCKET/$S3_PREFIX/"
aws s3 cp "$INTEL_PATH" "s3://$S3_BUCKET/$S3_PREFIX/$DMG_INTEL" \
  --content-type "application/x-apple-diskimage"
aws s3 cp "$ARM64_PATH" "s3://$S3_BUCKET/$S3_PREFIX/$DMG_ARM64" \
  --content-type "application/x-apple-diskimage"

# ─── Done ────────────────────────────────────────────────────────────────
cat <<EOF

$(printf "\033[1;32m✓ Release published\033[0m")

  Apple Silicon:  https://$S3_BUCKET.s3.us-east-1.amazonaws.com/$S3_PREFIX/$DMG_ARM64
  Intel:          https://$S3_BUCKET.s3.us-east-1.amazonaws.com/$S3_PREFIX/$DMG_INTEL

EOF
