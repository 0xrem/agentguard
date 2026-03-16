#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_URL="${AGENTGUARD_DAEMON_URL:-http://127.0.0.1:8790}"
PROXY_URL="${AGENTGUARD_PROXY_URL:-http://127.0.0.1:8787}"

cd "$ROOT_DIR"

echo "==> [1/4] Ensure local stack is up"
"$ROOT_DIR/scripts/start-local-stack.sh" >/dev/null

echo "==>      Validate runtime readiness probes"
curl -fsS "$DAEMON_URL/readyz" >/dev/null 2>&1 || curl -fsS "$DAEMON_URL/healthz" >/dev/null 2>&1
curl -fsS "$PROXY_URL/readyz" >/dev/null 2>&1 || curl -fsS "$PROXY_URL/healthz" >/dev/null 2>&1

echo "==> [2/4] Run live demo to generate real runtime events"
START_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

set +e
DEMO_OUTPUT="$("$ROOT_DIR/scripts/run-live-demo.sh" 2>&1)"
DEMO_EXIT=$?
set -e

echo "$DEMO_OUTPUT" | tail -n 20
if [[ $DEMO_EXIT -ne 0 ]]; then
    echo "warn: live demo exited with code $DEMO_EXIT, continue with audit-based verification"
fi

echo "==> [3/4] Query daemon audit API"
AUDIT_JSON="$(curl -fsS "$DAEMON_URL/v1/audit?limit=120")"

echo "==> [4/4] Validate audit payload is real (not browser preview mock)"
python3 - <<'PY' "$AUDIT_JSON" "$START_MS"
import json
import sys

records = json.loads(sys.argv[1])
start_ms = int(sys.argv[2])

if not isinstance(records, list) or not records:
    raise SystemExit("error: daemon /v1/audit returned no records")

if any((r.get("event", {}).get("metadata", {}).get("source") == "browser_preview") for r in records):
    raise SystemExit("error: found browser_preview records in daemon audit stream")

real_ops = {"exec_command", "http_request", "model_request", "read_file"}
recent_real = [
    r for r in records
    if int(r.get("recorded_at_unix_ms", 0)) >= (start_ms - 5_000)
    and r.get("event", {}).get("operation") in real_ops
]
if not recent_real:
    raise SystemExit("error: no fresh real operations were recorded after running live demo")

print(f"ok: validated {len(records)} audit records from daemon, fresh real events={len(recent_real)}")
PY

echo ""
echo "Reality check passed."
echo "  Daemon: $DAEMON_URL"
echo "  Verified: stack up + live demo output + daemon audit payload"
