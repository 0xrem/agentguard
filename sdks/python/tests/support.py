from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional

ROOT_DIR = Path(__file__).resolve().parents[3]
DAEMON_BINARY = ROOT_DIR / "target" / "debug" / "agentguard-daemon"
PROXY_BINARY = ROOT_DIR / "target" / "debug" / "agentguard-proxy"


class BinaryProcess:
    def __init__(self, binary: Path, env: dict[str, str]) -> None:
        self.binary = binary
        self.env = env
        self.process: Optional[subprocess.Popen[str]] = None

    def start(self) -> None:
        self.process = subprocess.Popen(
            [str(self.binary)],
            cwd=ROOT_DIR,
            env={**os.environ, **self.env},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

    def stop(self) -> None:
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self.process.stdout is not None:
            self.process.stdout.close()
        self.process = None


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


def wait_for_health(url: str, process: BinaryProcess) -> None:
    for _ in range(80):
        if process.process is not None and process.process.poll() is not None:
            output = ""
            if process.process.stdout is not None:
                output = process.process.stdout.read()
            raise AssertionError(
                f"process {process.binary.name} exited before becoming healthy:\n{output}"
            )

        try:
            payload = daemon_get_json(f"{url}/healthz")
        except urllib.error.URLError:
            time.sleep(0.1)
            continue

        if payload.get("status") == "ok":
            return
        time.sleep(0.1)

    raise AssertionError(f"{url} did not become healthy in time")


def approve_next_request_via_daemon(daemon_url: str, reason: str) -> None:
    for _ in range(60):
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


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def new_temp_db(prefix: str) -> tuple[tempfile.TemporaryDirectory[str], str]:
    temp_dir = tempfile.TemporaryDirectory(prefix=prefix)
    return temp_dir, str(Path(temp_dir.name, "agentguard-test.db"))
