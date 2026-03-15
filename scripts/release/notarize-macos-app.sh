#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PATH="${APP_PATH:-${1:-$ROOT_DIR/target/release/bundle/macos/AgentGuard.app}}"
NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-${NOTARY_PROFILE:-}}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT_DIR/target/release/bundle/notarization}"
ZIP_PATH="$ARTIFACT_DIR/AgentGuard.app.zip"

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: app bundle not found at $APP_PATH" >&2
  exit 1
fi

if [[ -z "$NOTARY_PROFILE" ]]; then
  echo "error: APPLE_NOTARY_PROFILE is required for notarization" >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"
rm -f "$ZIP_PATH"

echo "==> Creating notarization archive"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

echo "==> Submitting to Apple notarization service"
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> Stapling notarization ticket"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "==> Notarization completed"
