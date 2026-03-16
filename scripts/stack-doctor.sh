#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${AGENTGUARD_RUNTIME_DIR:-$ROOT_DIR/.agentguard/runtime}"
DAEMON_URL="${AGENTGUARD_DAEMON_URL:-http://127.0.0.1:8790}"
PROXY_URL="${AGENTGUARD_PROXY_URL:-http://127.0.0.1:8787}"

section() {
  echo
  echo "## $1"
}

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

pretty_json() {
  python3 - <<'PY' "$1"
import json
import sys

raw = sys.argv[1]
try:
    obj = json.loads(raw)
except Exception:
    print(raw)
    raise SystemExit(0)
print(json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True))
PY
}

probe_service() {
  local url="$1"
  local ready_output
  local ready_code

  set +e
  ready_output="$(curl -sS "$url/readyz")"
  ready_code=$?
  set -e

  if [[ $ready_code -eq 0 ]]; then
    echo "probe_endpoint: $url/readyz"
    echo "probe_status: ok"
    pretty_json "$ready_output"
    return 0
  fi

  local health_output
  local health_code
  set +e
  health_output="$(curl -sS "$url/healthz")"
  health_code=$?
  set -e

  echo "probe_endpoint: $url/readyz"
  echo "probe_status: failed (fallback to /healthz)"
  echo "probe_error: curl_exit_code=$ready_code"
  if [[ $health_code -eq 0 ]]; then
    echo "fallback_endpoint: $url/healthz"
    echo "fallback_status: ok"
    pretty_json "$health_output"
  else
    echo "fallback_endpoint: $url/healthz"
    echo "fallback_status: failed"
    echo "fallback_error: curl_exit_code=$health_code"
  fi
}

print_port_ownership() {
  local label="$1"
  local url="$2"
  local pid_file="$3"
  local port
  port="$(port_from_url "$url")"

  echo "service: $label"
  echo "url: $url"
  echo "port: $port"

  if [[ -f "$pid_file" ]]; then
    local tracked_pid
    tracked_pid="$(tr -d '[:space:]' < "$pid_file")"
    if [[ -n "$tracked_pid" ]]; then
      echo "tracked_pid_file: $pid_file"
      echo "tracked_pid: $tracked_pid"
    fi
  else
    echo "tracked_pid_file: missing ($pid_file)"
  fi

  local listener_pids
  listener_pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"

  if [[ -z "$listener_pids" ]]; then
    echo "listeners: none"
    return 0
  fi

  echo "listeners:"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    ps -p "$pid" -o user=,pid=,ppid=,etime=,command= | sed 's/^/  /'
  done <<< "$listener_pids"
}

recent_failure_reason() {
  local log_file="$1"
  local label="$2"

  echo "service: $label"
  echo "log_file: $log_file"

  if [[ ! -f "$log_file" ]]; then
    echo "recent_failure_reason: none (log file missing)"
    return 0
  fi

  local line
  line="$(tail -n 200 "$log_file" | grep -Ei 'error|panic|failed|timed out|connection refused|address already in use' | tail -n 1 || true)"
  if [[ -n "$line" ]]; then
    echo "recent_failure_reason: $line"
  else
    echo "recent_failure_reason: none detected in last 200 log lines"
  fi
}

section "Stack Doctor Summary"
echo "workspace: $ROOT_DIR"
echo "runtime_dir: $RUNTIME_DIR"
echo "checked_at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

section "Port Occupancy And Ownership"
print_port_ownership "agentguard-daemon" "$DAEMON_URL" "$RUNTIME_DIR/daemon.pid"
print_port_ownership "agentguard-proxy" "$PROXY_URL" "$RUNTIME_DIR/proxy.pid"

section "Readiness Probe Details"
probe_service "$DAEMON_URL"
probe_service "$PROXY_URL"

section "Recent Failure Reasons"
recent_failure_reason "$RUNTIME_DIR/daemon.log" "agentguard-daemon"
recent_failure_reason "$RUNTIME_DIR/proxy.log" "agentguard-proxy"

echo
echo "stack doctor completed"
