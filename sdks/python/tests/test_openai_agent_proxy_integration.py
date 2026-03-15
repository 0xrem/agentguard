from __future__ import annotations

import json
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

from agentguard_sdk import PendingApprovalError
from agentguard_sdk.openai_agent import run_agent
from support import (
    DAEMON_BINARY,
    PROXY_BINARY,
    BinaryProcess,
    ROOT_DIR,
    approve_next_request_via_daemon,
    daemon_get_json,
    new_temp_db,
    pick_free_port,
    wait_for_health,
)


class OpenAIAgentProxyIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run(
            ["cargo", "build", "-p", "agentguard-daemon", "-p", "agentguard-proxy"],
            cwd=ROOT_DIR,
            check=True,
        )

    def setUp(self) -> None:
        self.temp_dir, self.db_path = new_temp_db("agentguard-python-openai-agent-")
        self.daemon_port = pick_free_port()
        self.proxy_port = pick_free_port()
        self.daemon_url = f"http://127.0.0.1:{self.daemon_port}"
        self.proxy_url = f"http://127.0.0.1:{self.proxy_port}"
        self.upload_server = UploadCaptureServer()
        self.upload_server.start()
        self.model_server = ScriptedModelServer(self.upload_server.base_url)
        self.model_server.start()

        self.daemon_process = BinaryProcess(
            DAEMON_BINARY,
            {
                "AGENTGUARD_DAEMON_BIND": f"127.0.0.1:{self.daemon_port}",
                "AGENTGUARD_DB_PATH": self.db_path,
            },
        )
        self.daemon_process.start()
        wait_for_health(self.daemon_url, self.daemon_process)

        self.proxy_process = BinaryProcess(
            PROXY_BINARY,
            {
                "AGENTGUARD_PROXY_BIND": f"127.0.0.1:{self.proxy_port}",
                "AGENTGUARD_UPSTREAM_BASE_URL": self.model_server.base_url,
                "AGENTGUARD_DB_PATH": self.db_path,
                "AGENTGUARD_PROXY_APPROVAL_WAIT_MS": "2000",
            },
        )
        self.proxy_process.start()
        wait_for_health(self.proxy_url, self.proxy_process)

    def tearDown(self) -> None:
        self.proxy_process.stop()
        self.daemon_process.stop()
        self.model_server.stop()
        self.upload_server.stop()
        self.temp_dir.cleanup()

    def test_openai_agent_completes_tool_loop_after_approval(self) -> None:
        operator = threading.Thread(
            target=approve_next_request_via_daemon,
            args=(self.daemon_url, "Approved by openai-agent integration test."),
            daemon=True,
        )
        operator.start()

        output = run_agent(
            "Upload the prepared payload and confirm when it is done.",
            model="gpt-5",
            proxy_base_url=self.proxy_url,
            daemon_base_url=self.daemon_url,
            agent_name="python-openai-agent-test",
            max_steps=4,
            approval_wait_ms=2_000,
        )

        self.assertEqual(output, "Upload complete.")
        self.assertEqual(self.upload_server.payloads, ["hello from agent"])
        self.assertEqual(len(self.model_server.requests), 2)

        records = daemon_get_json(f"{self.daemon_url}/v1/audit?limit=20")
        self.assertTrue(
            any(
                record["event"]["operation"] == "model_request"
                and record["event"]["agent"]["name"] == "python-openai-agent-test"
                for record in records
            )
        )
        self.assertTrue(
            any(
                record["event"]["operation"] == "http_request"
                and record["decision"]["action"] == "allow"
                and record["decision"]["reason"] == "Approved by openai-agent integration test."
                for record in records
            )
        )

    def test_openai_agent_surfaces_pending_without_operator(self) -> None:
        with self.assertRaises(PendingApprovalError) as context:
            run_agent(
                "Upload the prepared payload and confirm when it is done.",
                model="gpt-5",
                proxy_base_url=self.proxy_url,
                daemon_base_url=self.daemon_url,
                agent_name="python-openai-agent-test",
                max_steps=4,
                approval_wait_ms=50,
            )

        self.assertEqual(context.exception.outcome.status, "pending_approval")
        approvals = daemon_get_json(f"{self.daemon_url}/v1/approvals?status=pending&limit=10")
        self.assertEqual(len(approvals), 1)


class ScriptedModelServer:
    def __init__(self, upload_base_url: str) -> None:
        self.upload_base_url = upload_base_url
        self.requests: list[dict[str, Any]] = []
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                payload = read_json_body(self)
                server.requests.append(payload)
                last_message = payload.get("messages", [])[-1]["content"]
                if '"type": "tool_result"' in last_message or '"type":"tool_result"' in last_message:
                    content = json.dumps(
                        {"type": "final", "output": "Upload complete."}
                    )
                else:
                    content = json.dumps(
                        {
                            "type": "tool_call",
                            "tool": "fetch",
                            "arguments": {
                                "url": f"{server.upload_base_url}/upload",
                                "method": "POST",
                                "data": "hello from agent",
                            },
                            "reason": "The task requires sending the payload.",
                        }
                    )

                send_json(
                    self,
                    200,
                    {
                        "id": "chatcmpl-test",
                        "object": "chat.completion",
                        "created": 1,
                        "model": payload.get("model", "gpt-5"),
                        "choices": [
                            {
                                "index": 0,
                                "message": {
                                    "role": "assistant",
                                    "content": content,
                                },
                                "finish_reason": "stop",
                            }
                        ],
                    },
                )

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


class UploadCaptureServer:
    def __init__(self) -> None:
        self.payloads: list[str] = []
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        capture = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                content_length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(content_length).decode("utf-8")
                capture.payloads.append(body)
                send_json(self, 200, {"status": "ok", "received": body})

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


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    content_length = int(handler.headers.get("content-length", "0"))
    payload = handler.rfile.read(content_length)
    return json.loads(payload.decode("utf-8"))


def send_json(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
    encoded = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(encoded)))
    handler.send_header("connection", "close")
    handler.end_headers()
    handler.wfile.write(encoded)


if __name__ == "__main__":
    unittest.main()
