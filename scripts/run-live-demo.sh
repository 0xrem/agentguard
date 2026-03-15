#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_URL="${AGENTGUARD_DAEMON_URL:-http://127.0.0.1:8790}"
PROXY_URL="${AGENTGUARD_PROXY_URL:-http://127.0.0.1:8787}"
PY_PATH="$ROOT_DIR/sdks/python/src"

"$ROOT_DIR/scripts/start-local-stack.sh"

cd "$ROOT_DIR"

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  echo "==> Running OpenAI-compatible live demo through the local proxy"
  PYTHONPATH="$PY_PATH" python3 sdks/python/examples/openai_chat_agent.py \
    "Read the repository README, then run a harmless local shell command and report when it succeeds." \
    --proxy-base-url "$PROXY_URL" \
    --daemon-base-url "$DAEMON_URL" \
    --wait-for-approval-ms 30000
else
  echo "==> Running local daemon approval demo"
  PYTHONPATH="$PY_PATH" python3 sdks/python/examples/live_demo_agent.py \
    --daemon-base-url "$DAEMON_URL" \
    --wait-for-approval-ms 30000
fi
