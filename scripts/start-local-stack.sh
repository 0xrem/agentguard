#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${AGENTGUARD_RUNTIME_DIR:-$ROOT_DIR/.agentguard/runtime}"
DB_PATH="${AGENTGUARD_DB_PATH:-$ROOT_DIR/.agentguard/agentguard.db}"
DAEMON_URL="${AGENTGUARD_DAEMON_URL:-http://127.0.0.1:8790}"
PROXY_URL="${AGENTGUARD_PROXY_URL:-http://127.0.0.1:8787}"

mkdir -p "$RUNTIME_DIR"

url_to_bind() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse
import sys

parsed = urlparse(sys.argv[1])
host = parsed.hostname
port = parsed.port
if not host or not port:
    raise SystemExit(f"invalid bind URL: {sys.argv[1]}")
print(f"{host}:{port}")
PY
}

wait_for_health() {
  local url="$1"
  local timeout_seconds="${2:-20}"
  python3 - "$url" "$timeout_seconds" <<'PY'
import sys
import time
import urllib.request

url = sys.argv[1].rstrip("/") + "/healthz"
deadline = time.time() + float(sys.argv[2])

while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=1.5) as response:
            if 200 <= response.status < 300:
                raise SystemExit(0)
    except Exception:
        time.sleep(0.2)

raise SystemExit(1)
PY
}

health_is_up() {
  wait_for_health "$1" 0.8 >/dev/null 2>&1
}

start_service() {
  local label="$1"
  local binary="$2"
  local pid_file="$3"
  local log_file="$4"
  local health_url="$5"
  shift 5

  if health_is_up "$health_url"; then
    echo "==> ${label} already healthy at $health_url"
    return 0
  fi

  if [[ -f "$pid_file" ]]; then
    local stale_pid
    stale_pid="$(cat "$pid_file")"
    if kill -0 "$stale_pid" >/dev/null 2>&1; then
      echo "==> ${label} is already running with pid ${stale_pid}"
      if wait_for_health "$health_url" 5; then
        return 0
      fi
    else
      rm -f "$pid_file"
    fi
  fi

  if [[ ! -x "$binary" ]]; then
    echo "==> Building ${label} binary"
    cargo build -p "$label" >/dev/null
  fi

  echo "==> Starting ${label}"
  python3 - "$ROOT_DIR" "$binary" "$log_file" "$pid_file" "$@" <<'PY'
import os
import subprocess
import sys

root_dir = sys.argv[1]
binary = sys.argv[2]
log_file = sys.argv[3]
pid_file = sys.argv[4]
env_pairs = sys.argv[5:]

env = os.environ.copy()
for pair in env_pairs:
    key, value = pair.split("=", 1)
    env[key] = value

with open(log_file, "ab") as log_handle:
    process = subprocess.Popen(
        [binary],
        cwd=root_dir,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

with open(pid_file, "w", encoding="utf-8") as pid_handle:
    pid_handle.write(f"{process.pid}\n")
PY

  if ! wait_for_health "$health_url" 20; then
    echo "error: ${label} did not become healthy in time. See ${log_file}" >&2
    exit 1
  fi

  echo "==> ${label} ready at $health_url (pid $(cat "$pid_file"))"
}

DAEMON_BIND="$(url_to_bind "$DAEMON_URL")"
PROXY_BIND="$(url_to_bind "$PROXY_URL")"
DAEMON_BIN="$ROOT_DIR/target/debug/agentguard-daemon"
PROXY_BIN="$ROOT_DIR/target/debug/agentguard-proxy"
DAEMON_PID_FILE="$RUNTIME_DIR/daemon.pid"
PROXY_PID_FILE="$RUNTIME_DIR/proxy.pid"
DAEMON_LOG="$RUNTIME_DIR/daemon.log"
PROXY_LOG="$RUNTIME_DIR/proxy.log"

start_service \
  "agentguard-daemon" \
  "$DAEMON_BIN" \
  "$DAEMON_PID_FILE" \
  "$DAEMON_LOG" \
  "$DAEMON_URL" \
  "AGENTGUARD_DB_PATH=$DB_PATH" \
  "AGENTGUARD_DAEMON_BIND=$DAEMON_BIND"

PROXY_ENV=(
  "AGENTGUARD_DB_PATH=$DB_PATH"
  "AGENTGUARD_DAEMON_BIND=$DAEMON_BIND"
  "AGENTGUARD_PROXY_BIND=$PROXY_BIND"
)

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  PROXY_ENV+=("AGENTGUARD_UPSTREAM_API_KEY=$OPENAI_API_KEY")
fi

if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
  PROXY_ENV+=("AGENTGUARD_UPSTREAM_BASE_URL=${OPENAI_BASE_URL%/v1}")
fi

start_service \
  "agentguard-proxy" \
  "$PROXY_BIN" \
  "$PROXY_PID_FILE" \
  "$PROXY_LOG" \
  "$PROXY_URL" \
  "${PROXY_ENV[@]}"

echo
echo "AgentGuard local stack is up."
echo "  Daemon: $DAEMON_URL"
echo "  Proxy:  $PROXY_URL"
echo "  DB:     $DB_PATH"
echo "  Logs:   $RUNTIME_DIR"
