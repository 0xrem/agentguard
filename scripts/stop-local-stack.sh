#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${AGENTGUARD_RUNTIME_DIR:-$ROOT_DIR/.agentguard/runtime}"
DAEMON_URL="${AGENTGUARD_DAEMON_URL:-http://127.0.0.1:8790}"
PROXY_URL="${AGENTGUARD_PROXY_URL:-http://127.0.0.1:8787}"

port_from_url() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse
import sys

parsed = urlparse(sys.argv[1])
if not parsed.port:
    raise SystemExit(f"invalid URL (missing port): {sys.argv[1]}")
print(parsed.port)
PY
}

stop_from_port() {
  local label="$1"
  local url="$2"
  local port
  port="$(port_from_url "$url")"

  local found=0
  local pid
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    if ps -p "$pid" -o command= 2>/dev/null | grep -q "$label"; then
      if [[ $found -eq 0 ]]; then
        echo "==> Stopping ${label} discovered on port ${port}"
      fi
      found=1
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)

  if [[ $found -eq 0 ]]; then
    echo "==> ${label} not found on port ${port}"
  fi
}

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
stop_from_port "agentguard-proxy" "$PROXY_URL"
stop_from_port "agentguard-daemon" "$DAEMON_URL"

echo
echo "AgentGuard local stack stop request sent."
