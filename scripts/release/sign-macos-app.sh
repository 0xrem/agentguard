#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PATH="${APP_PATH:-${1:-$ROOT_DIR/target/release/bundle/macos/AgentGuard.app}}"
IDENTITY="${APPLE_CODESIGN_IDENTITY:-${CODESIGN_IDENTITY:-}}"
SIGN_MODE="${SIGN_MODE:-developer-id}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: app bundle not found at $APP_PATH" >&2
  exit 1
fi

if [[ -z "$IDENTITY" ]]; then
  if [[ "$SIGN_MODE" == "adhoc" ]]; then
    IDENTITY="-"
  else
    echo "error: APPLE_CODESIGN_IDENTITY is required for Developer ID signing" >&2
    exit 1
  fi
fi

sign_target() {
  local target="$1"
  local mode="$2"

  if [[ "$mode" == "adhoc" ]]; then
    codesign --force --sign "$IDENTITY" "$target"
  else
    codesign --force --timestamp --options runtime --sign "$IDENTITY" "$target"
  fi
}

echo "==> Signing nested runtime binaries"
sign_target "$APP_PATH/Contents/Resources/runtime/agentguard-daemon" "$SIGN_MODE"
sign_target "$APP_PATH/Contents/Resources/runtime/agentguard-proxy" "$SIGN_MODE"

echo "==> Signing desktop executable"
sign_target "$APP_PATH/Contents/MacOS/agentguard-desktop" "$SIGN_MODE"

if [[ -d "$APP_PATH/Contents/Frameworks" ]]; then
  echo "==> Signing embedded frameworks"
  while IFS= read -r framework_path; do
    sign_target "$framework_path" "$SIGN_MODE"
  done < <(find "$APP_PATH/Contents/Frameworks" -type d \( -name '*.framework' -o -name '*.app' \) | sort)
fi

echo "==> Signing app bundle"
sign_target "$APP_PATH" "$SIGN_MODE"

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
echo "==> Signing completed"
