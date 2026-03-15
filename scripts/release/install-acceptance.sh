#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_PATH="${APP_PATH:-${1:-$ROOT_DIR/target/release/bundle/macos/AgentGuard.app}}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "error: app bundle not found at $APP_PATH" >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "error: $PYTHON_BIN is required for install acceptance" >&2
  exit 1
fi

TEST_ROOT="$(mktemp -d /tmp/agentguard-install-acceptance.XXXXXX)"
INSTALL_ROOT="$TEST_ROOT/Applications"
INSTALL_APP="$INSTALL_ROOT/AgentGuard.app"
APP_EXEC="$INSTALL_APP/Contents/MacOS/agentguard-desktop"
DAEMON_BIN="$INSTALL_APP/Contents/Resources/runtime/agentguard-daemon"
PROXY_BIN="$INSTALL_APP/Contents/Resources/runtime/agentguard-proxy"
PYTHONPATH_ROOT="$INSTALL_APP/Contents/Resources/python"
LIVE_DEMO="$INSTALL_APP/Contents/Resources/python/live_demo_agent.py"
APP_SUPPORT="$TEST_ROOT/app-support"
LOG_ROOT="$APP_SUPPORT/logs"
DB_PATH="$APP_SUPPORT/agentguard.db"
DAEMON_URL="http://127.0.0.1:18790"
PROXY_URL="http://127.0.0.1:18787"
DAEMON_BIND="127.0.0.1:18790"
PROXY_BIND="127.0.0.1:18787"
DAEMON_LOG="$LOG_ROOT/daemon.log"
PROXY_LOG="$LOG_ROOT/proxy.log"
APP_LOG="$LOG_ROOT/app.log"
APP_PID=""
DAEMON_PID=""
PROXY_PID=""
DEMO_PID=""

cleanup() {
  for pid in "$DEMO_PID" "$PROXY_PID" "$DAEMON_PID" "$APP_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT

mkdir -p "$INSTALL_ROOT" "$LOG_ROOT"
cp -R "$APP_PATH" "$INSTALL_APP"

echo "==> Copied app bundle to $INSTALL_APP"

for path in "$APP_EXEC" "$DAEMON_BIN" "$PROXY_BIN" "$LIVE_DEMO"; do
  if [[ ! -e "$path" ]]; then
    echo "error: expected bundled path missing after install copy: $path" >&2
    exit 1
  fi
done

echo "==> Launching relocated desktop app"
"$APP_EXEC" >"$APP_LOG" 2>&1 &
APP_PID="$!"
sleep 3
if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
  echo "error: relocated desktop app exited early" >&2
  cat "$APP_LOG" >&2 || true
  exit 1
fi

echo "==> Starting bundled daemon and proxy outside the repo"
AGENTGUARD_DB_PATH="$DB_PATH" \
AGENTGUARD_DAEMON_BIND="$DAEMON_BIND" \
"$DAEMON_BIN" >"$DAEMON_LOG" 2>&1 &
DAEMON_PID="$!"

AGENTGUARD_DB_PATH="$DB_PATH" \
AGENTGUARD_DAEMON_BIND="$DAEMON_BIND" \
AGENTGUARD_PROXY_BIND="$PROXY_BIND" \
"$PROXY_BIN" >"$PROXY_LOG" 2>&1 &
PROXY_PID="$!"

"$PYTHON_BIN" - <<'PY' "$DAEMON_URL" "$PROXY_URL"
import sys
import time
import urllib.request

for base_url in sys.argv[1:]:
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base_url + "/healthz", timeout=1.5) as response:
                if 200 <= response.status < 300:
                    break
        except Exception:
            time.sleep(0.2)
    else:
        raise SystemExit(f"timed out waiting for {base_url}")
PY

echo "==> Running bundled live demo from relocated app"
PYTHONPATH="$PYTHONPATH_ROOT" "$PYTHON_BIN" "$LIVE_DEMO" --daemon-base-url "$DAEMON_URL" --wait-for-approval-ms 30000 >"$LOG_ROOT/demo.stdout" 2>"$LOG_ROOT/demo.stderr" &
DEMO_PID="$!"

"$PYTHON_BIN" - <<'PY' "$DAEMON_URL"
import json
import sys
import time
import urllib.request

base = sys.argv[1]
deadline = time.time() + 20

while time.time() < deadline:
    try:
        with urllib.request.urlopen(base + "/v1/approvals?status=pending&limit=10", timeout=1.5) as response:
            approvals = json.load(response)
    except Exception:
        time.sleep(0.2)
        continue

    if approvals:
        approval_id = approvals[0]["id"]
        payload = json.dumps(
            {
                "action": "allow",
                "decided_by": "install-acceptance",
                "reason": "Approved during relocated app acceptance test.",
            }
        ).encode()
        request = urllib.request.Request(
            base + f"/v1/approvals/{approval_id}/resolve",
            data=payload,
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=1.5):
            pass
        break

    time.sleep(0.2)
else:
    raise SystemExit("timed out waiting for live demo approval")
PY

wait "$DEMO_PID"
DEMO_PID=""

if ! grep -q "agentguard-live-demo" "$LOG_ROOT/demo.stdout"; then
  echo "error: bundled live demo did not emit the expected output" >&2
  cat "$LOG_ROOT/demo.stdout" >&2 || true
  cat "$LOG_ROOT/demo.stderr" >&2 || true
  exit 1
fi

echo "==> Install acceptance passed"
echo "    Test root: $TEST_ROOT"
echo "    App log:   $APP_LOG"
echo "    Demo log:  $LOG_ROOT/demo.stderr"
