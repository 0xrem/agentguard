#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Building desktop app bundle"
pnpm --dir "$ROOT_DIR" desktop:build

echo "==> Verifying unsigned or pre-signed bundle"
"$ROOT_DIR/scripts/release/verify-macos-app.sh"

echo "==> Running relocated install acceptance"
"$ROOT_DIR/scripts/release/install-acceptance.sh"

if [[ -n "${APPLE_CODESIGN_IDENTITY:-${CODESIGN_IDENTITY:-}}" ]]; then
  echo "==> Signing app bundle"
  "$ROOT_DIR/scripts/release/sign-macos-app.sh"
else
  echo "==> No Developer ID identity was provided; applying ad hoc signing for local validation"
  SIGN_MODE=adhoc "$ROOT_DIR/scripts/release/sign-macos-app.sh"
fi

if [[ -n "${APPLE_NOTARY_PROFILE:-${NOTARY_PROFILE:-}}" ]]; then
  echo "==> Submitting signed app for notarization"
  "$ROOT_DIR/scripts/release/notarize-macos-app.sh"
else
  echo "==> Skipping notarization because no APPLE_NOTARY_PROFILE was provided"
  echo "==> A real distribution release still requires a Developer ID Application certificate and an Apple notarization profile"
fi

echo "==> Final verification"
"$ROOT_DIR/scripts/release/verify-macos-app.sh"
