#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "error: required command '$name' was not found in PATH" >&2
    exit 1
  fi
}

require_command cargo
require_command pnpm
require_command python3

cd "$ROOT_DIR"

echo "==> Installing JavaScript dependencies"
pnpm install --frozen-lockfile

echo "==> Installing Python SDK in editable mode"
python3 -m pip install -e "$ROOT_DIR/sdks/python"

echo "==> Building local runtime binaries"
cargo build -p agentguard-daemon -p agentguard-proxy

echo "==> Building desktop frontend assets"
pnpm --filter @agentguard/desktop build

echo
echo "AgentGuard local bootstrap is ready."
echo "Next steps:"
echo "  pnpm stack:up"
echo "  pnpm demo:live"
echo "  pnpm desktop:build"
