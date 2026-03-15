from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

from agentguard_sdk import AgentGuardClient, PendingApprovalError, guarded_fetch

ROOT_DIR = Path(__file__).resolve().parents[3]
DAEMON_BINARY = ROOT_DIR / "target" / "debug" / "agentguard-daemon"


class AgentGuardPythonDaemonIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run(
            ["cargo", "build", "-p", "agentguard-daemon"],
            cwd=ROOT_DIR,
            check=True,
        )

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="agentguard-python-integration-")
        self.port = pick_free_port()
        self.daemon_url = f"http://127.0.0.1:{self.port}"
        self.db_path = str(Path(self.temp_dir.name, "agentguard-test.db"))
        self.daemon_process = subprocess.Popen(
            [str(DAEMON_BINARY)],
            cwd=ROOT_DIR,
            env={
                **os.environ,
                "AGENTGUARD_DAEMON_BIND": f"127.0.0.1:{self.port}",
                "AGENTGUARD_DB_PATH": self.db_path,
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        wait_for_daemon_health(self.daemon_url, self.daemon_process)
        self.client = AgentGuardClient(
            base_url=self.daemon_url,
            agent="python-integration-agent",
        )

    def tearDown(self) -> None:
        if self.daemon_process.poll() is None:
            self.daemon_process.terminate()
            try:
                self.daemon_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.daemon_process.kill()
                self.daemon_process.wait(timeout=5)
        if self.daemon_process.stdout is not None:
            self.daemon_process.stdout.close()
        self.temp_dir.cleanup()

    def test_guarded_fetch_waits_for_desktop_style_approval(self) -> None:
        upstream = TextServer("ok")
        upstream.start()
        operator = threading.Thread(
            target=approve_next_request_via_desktop_api,
            args=(self.daemon_url, "Approved by desktop operator test."),
            daemon=True,
        )
        operator.start()

        try:
            result = guarded_fetch(
                self.client,
                f"{upstream.base_url}/upload",
                method="POST",
                data=b'{"hello":"world"}',
                wait_for_approval_ms=2_000,
            )
            body = result.value.read().decode("utf-8")
            result.value.close()
        finally:
            upstream.stop()

        self.assertEqual(body, "ok")
        self.assertEqual(result.audit_record.decision.action, "allow")
        self.assertEqual(
            result.audit_record.decision.reason,
            "Approved by desktop operator test.",
        )
        self.assertTrue(
            any(
                record.decision.action == "allow"
                and record.decision.reason == "Approved by desktop operator test."
                and record.event.operation == "http_request"
                for record in self.client.list_audit(10)
            )
        )

    def test_guarded_fetch_raises_pending_when_no_operator_responds(self) -> None:
        upstream = TextServer("ok")
        upstream.start()

        try:
            with self.assertRaises(PendingApprovalError) as context:
                guarded_fetch(
                    self.client,
                    f"{upstream.base_url}/upload",
                    method="POST",
                    data=b"payload",
                    wait_for_approval_ms=50,
                )
        finally:
            upstream.stop()

        self.assertEqual(context.exception.outcome.status, "pending_approval")
        approvals = daemon_get_json(f"{self.daemon_url}/v1/approvals?status=pending&limit=10")
        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]["status"], "pending")


class TextServer:
    def __init__(self, text: str) -> None:
        self.text = text
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        encoded = self.text.encode("utf-8")

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                self.send_response(200)
                self.send_header("content-type", "text/plain")
                self.send_header("content-length", str(len(encoded)))
                self.send_header("connection", "close")
                self.end_headers()
                self.wfile.write(encoded)

            def do_POST(self) -> None:  # noqa: N802
                _ = self.rfile.read(int(self.headers.get("content-length", "0")))
                self.do_GET()

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._server = None
        self._thread = None

    @property
    def base_url(self) -> str:
        assert self._server is not None
        host, port = self._server.server_address
        return f"http://{host}:{port}"


def approve_next_request_via_desktop_api(daemon_url: str, reason: str) -> None:
    for _ in range(50):
        approvals = daemon_get_json(f"{daemon_url}/v1/approvals?status=pending&limit=10")
        if approvals:
            daemon_post_json(
                f"{daemon_url}/v1/approvals/{approvals[0]['id']}/resolve",
                {
                    "action": "allow",
                    "decided_by": "desktop-operator-test",
                    "reason": reason,
                },
            )
            return
        time.sleep(0.05)

    raise AssertionError("desktop operator did not observe a pending approval in time")


def wait_for_daemon_health(daemon_url: str, process: subprocess.Popen[str]) -> None:
    for _ in range(60):
        if process.poll() is not None:
            output = ""
            if process.stdout is not None:
                output = process.stdout.read()
            raise AssertionError(f"daemon exited before becoming healthy:\n{output}")

        try:
            payload = daemon_get_json(f"{daemon_url}/healthz")
        except urllib.error.URLError:
            time.sleep(0.1)
            continue

        if payload.get("status") == "ok":
            return

        time.sleep(0.1)

    raise AssertionError("daemon did not become healthy in time")


def daemon_get_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def daemon_post_json(url: str, body: dict[str, Any]) -> Any:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


if __name__ == "__main__":
    unittest.main()
