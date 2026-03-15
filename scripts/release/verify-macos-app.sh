#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PATH="${1:-$ROOT_DIR/target/release/bundle/macos/AgentGuard.app}"

require_path() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    echo "error: required path not found: $path" >&2
    exit 1
  fi
}

print_step() {
  echo
  echo "==> $1"
}

require_path "$APP_PATH"
require_path "$APP_PATH/Contents/MacOS/agentguard-desktop"
require_path "$APP_PATH/Contents/Resources/runtime/agentguard-daemon"
require_path "$APP_PATH/Contents/Resources/runtime/agentguard-proxy"
require_path "$APP_PATH/Contents/Resources/python/agentguard_sdk"
require_path "$APP_PATH/Contents/Resources/python/live_demo_agent.py"

print_step "Bundle layout"
du -sh "$APP_PATH" || true

print_step "Bundled runtime resources"
find "$APP_PATH/Contents/Resources" -maxdepth 2 \( -type f -o -type d \) | sort

print_step "Codesign details"
if codesign -dv --verbose=4 "$APP_PATH" 2>&1; then
  echo "codesign metadata read successfully"
else
  echo "warning: app is not signed or codesign metadata could not be read" >&2
fi

print_step "Codesign verification"
if codesign --verify --deep --strict --verbose=2 "$APP_PATH"; then
  echo "codesign verification passed"
else
  echo "warning: codesign verification failed" >&2
fi

print_step "Gatekeeper assessment"
if spctl --assess --type execute --verbose=4 "$APP_PATH"; then
  echo "Gatekeeper accepted the app"
else
  echo "warning: Gatekeeper rejected the app or the app is not notarized yet" >&2
fi

print_step "Stapler validation"
if xcrun stapler validate "$APP_PATH"; then
  echo "stapler validation passed"
else
  echo "warning: stapler validation failed or no notarization ticket is attached yet" >&2
fi
