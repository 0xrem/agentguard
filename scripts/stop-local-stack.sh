#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${AGENTGUARD_RUNTIME_DIR:-$ROOT_DIR/.agentguard/runtime}"

stop_from_pid_file() {
  local label="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "==> ${label} is not tracked locally"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"

  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "==> Stopping ${label} (pid ${pid})"
    kill "$pid"
  else
    echo "==> ${label} pid ${pid} is already gone"
  fi

  rm -f "$pid_file"
}

stop_from_pid_file "agentguard-proxy" "$RUNTIME_DIR/proxy.pid"
stop_from_pid_file "agentguard-daemon" "$RUNTIME_DIR/daemon.pid"

echo
echo "AgentGuard local stack stop request sent."
