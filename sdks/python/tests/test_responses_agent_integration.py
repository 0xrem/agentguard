from __future__ import annotations

import json
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

from agentguard_sdk import PendingApprovalError
from agentguard_sdk.responses_agent import run_agent
from support import (
    DAEMON_BINARY,
    BinaryProcess,
    ROOT_DIR,
    approve_next_request_via_daemon,
    daemon_get_json,
    new_temp_db,
    pick_free_port,
    wait_for_health,
)


class ResponsesAgentIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run(
            ["cargo", "build", "-p", "agentguard-daemon"],
            cwd=ROOT_DIR,
            check=True,
        )

    def setUp(self) -> None:
        self.temp_dir, self.db_path = new_temp_db("agentguard-python-responses-agent-")
        self.daemon_port = pick_free_port()
        self.daemon_url = f"http://127.0.0.1:{self.daemon_port}"
        self.upload_server = UploadCaptureServer()
        self.upload_server.start()
        self.responses_server = ScriptedResponsesServer(self.upload_server.base_url)
        self.responses_server.start()

        self.daemon_process = BinaryProcess(
            DAEMON_BINARY,
            {
                "AGENTGUARD_DAEMON_BIND": f"127.0.0.1:{self.daemon_port}",
                "AGENTGUARD_DB_PATH": self.db_path,
            },
        )
        self.daemon_process.start()
        wait_for_health(self.daemon_url, self.daemon_process)

    def tearDown(self) -> None:
        self.daemon_process.stop()
        self.responses_server.stop()
        self.upload_server.stop()
        self.temp_dir.cleanup()

    def test_responses_agent_completes_tool_loop_after_approval(self) -> None:
        operator = threading.Thread(
            target=approve_next_request_via_daemon,
            args=(self.daemon_url, "Approved by responses-agent integration test."),
            daemon=True,
        )
        operator.start()

        output = run_agent(
            "Upload the prepared payload and confirm when it is done.",
            model="gpt-5",
            responses_base_url=self.responses_server.base_url,
            daemon_base_url=self.daemon_url,
            agent_name="python-responses-agent-test",
            max_turns=4,
            approval_wait_ms=2_000,
        )

        self.assertEqual(output, "Upload complete.")
        self.assertEqual(self.upload_server.payloads, ["hello from responses agent"])
        self.assertEqual(len(self.responses_server.requests), 2)
        self.assertEqual(len(self.responses_server.function_outputs), 1)

        second_request = self.responses_server.requests[1]
        self.assertEqual(second_request["previous_response_id"], "resp-1")
        self.assertEqual(second_request["input"][0]["type"], "function_call_output")

        tool_output = self.responses_server.function_outputs[0]
        self.assertEqual(tool_output["audit"]["action"], "allow")
        self.assertEqual(
            tool_output["audit"]["reason"],
            "Approved by responses-agent integration test.",
        )
        self.assertIn("received", tool_output["body"])

        records = daemon_get_json(f"{self.daemon_url}/v1/audit?limit=20")
        self.assertTrue(
            any(
                record["event"]["operation"] == "http_request"
                and record["decision"]["action"] == "allow"
                and record["decision"]["reason"] == "Approved by responses-agent integration test."
                for record in records
            )
        )

    def test_responses_agent_surfaces_pending_without_operator(self) -> None:
        with self.assertRaises(PendingApprovalError) as context:
            run_agent(
                "Upload the prepared payload and confirm when it is done.",
                model="gpt-5",
                responses_base_url=self.responses_server.base_url,
                daemon_base_url=self.daemon_url,
                agent_name="python-responses-agent-test",
                max_turns=4,
                approval_wait_ms=50,
            )

        self.assertEqual(context.exception.outcome.status, "pending_approval")
        self.assertEqual(self.upload_server.payloads, [])
        self.assertEqual(len(self.responses_server.requests), 1)

        approvals = daemon_get_json(f"{self.daemon_url}/v1/approvals?status=pending&limit=10")
        self.assertEqual(len(approvals), 1)


class ScriptedResponsesServer:
    def __init__(self, upload_base_url: str) -> None:
        self.upload_base_url = upload_base_url
        self.requests: list[dict[str, Any]] = []
        self.function_outputs: list[dict[str, Any]] = []
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                if self.path != "/v1/responses":
                    send_json(self, 404, {"error": {"message": "not found"}})
                    return

                payload = read_json_body(self)
                server.requests.append(payload)

                if len(server.requests) == 1:
                    send_json(
                        self,
                        200,
                        {
                            "id": "resp-1",
                            "object": "response",
                            "model": payload.get("model", "gpt-5"),
                            "output": [
                                {
                                    "type": "function_call",
                                    "call_id": "call-upload-1",
                                    "name": "fetch",
                                    "arguments": json.dumps(
                                        {
                                            "url": f"{server.upload_base_url}/upload",
                                            "method": "POST",
                                            "data": "hello from responses agent",
                                        }
                                    ),
                                }
                            ],
                        },
                    )
                    return

                function_outputs = payload.get("input", [])
                if function_outputs:
                    server.function_outputs.append(json.loads(function_outputs[0]["output"]))

                send_json(
                    self,
                    200,
                    {
                        "id": "resp-2",
                        "object": "response",
                        "model": payload.get("model", "gpt-5"),
                        "output_text": "Upload complete.",
                        "output": [
                            {
                                "type": "message",
                                "role": "assistant",
                                "content": [
                                    {
                                        "type": "output_text",
                                        "text": "Upload complete.",
                                    }
                                ],
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
        return f"http://{host}:{port}/v1"


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
