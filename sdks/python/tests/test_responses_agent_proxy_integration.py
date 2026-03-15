from __future__ import annotations

import json
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

from agentguard_sdk import AgentGuardHttpError
from agentguard_sdk.responses_agent import run_agent
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


class ResponsesAgentProxyIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run(
            ["cargo", "build", "-p", "agentguard-daemon", "-p", "agentguard-proxy"],
            cwd=ROOT_DIR,
            check=True,
        )

    def setUp(self) -> None:
        self.temp_dir, self.db_path = new_temp_db("agentguard-python-responses-proxy-")
        self.daemon_port = pick_free_port()
        self.proxy_port = pick_free_port()
        self.daemon_url = f"http://127.0.0.1:{self.daemon_port}"
        self.proxy_url = f"http://127.0.0.1:{self.proxy_port}"
        self.model_server = ScriptedResponsesModelServer(str(Path(ROOT_DIR, "README.md")))
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
        self.temp_dir.cleanup()

    def test_responses_agent_can_continue_after_proxy_prompt_approval(self) -> None:
        operator = threading.Thread(
            target=approve_next_request_via_daemon,
            args=(self.daemon_url, "Approved by responses proxy integration test."),
            daemon=True,
        )
        operator.start()

        output = run_agent(
            "Read the project README and confirm when it is done.",
            model="gpt-5",
            responses_base_url=self.proxy_url,
            daemon_base_url=self.daemon_url,
            agent_name="python-responses-proxy-test",
            max_turns=4,
            approval_wait_ms=2_000,
        )

        self.assertEqual(output, "Read complete.")
        self.assertEqual(len(self.model_server.requests), 2)
        self.assertEqual(len(self.model_server.function_outputs), 1)
        self.assertIn("The runtime firewall for AI agents.", self.model_server.function_outputs[0])

        records = daemon_get_json(f"{self.daemon_url}/v1/audit?limit=20")
        self.assertTrue(
            any(
                record["event"]["operation"] == "model_response"
                and record["decision"]["action"] == "allow"
                and record["decision"]["reason"] == "Approved by responses proxy integration test."
                for record in records
            )
        )
        self.assertTrue(
            any(
                record["event"]["operation"] == "read_file"
                and record["decision"]["action"] == "allow"
                for record in records
            )
        )

    def test_responses_agent_surfaces_pending_when_proxy_prompt_approval_times_out(self) -> None:
        with self.assertRaises(AgentGuardHttpError) as context:
            run_agent(
                "Read the project README and confirm when it is done.",
                model="gpt-5",
                responses_base_url=self.proxy_url,
                daemon_base_url=self.daemon_url,
                agent_name="python-responses-proxy-test",
                max_turns=4,
                approval_wait_ms=2_000,
            )

        self.assertEqual(context.exception.status, 409)
        self.assertEqual(
            context.exception.details["error"]["type"],
            "agentguard_approval_pending",
        )
        approvals = daemon_get_json(f"{self.daemon_url}/v1/approvals?status=pending&limit=10")
        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]["audit_record"]["event"]["operation"], "model_response")
        self.assertEqual(len(self.model_server.requests), 1)


class ScriptedResponsesModelServer:
    def __init__(self, read_path: str) -> None:
        self.read_path = read_path
        self.requests: list[dict[str, Any]] = []
        self.function_outputs: list[str] = []
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
                            "id": "resp-proxy-1",
                            "object": "response",
                            "model": payload.get("model", "gpt-5"),
                            "output": [
                                {
                                    "type": "function_call",
                                    "call_id": "call-readme-1",
                                    "name": "read_file",
                                    "arguments": json.dumps(
                                        {
                                            "path": server.read_path,
                                            "encoding": "utf-8",
                                            "note": "upload credentials",
                                        }
                                    ),
                                }
                            ],
                        },
                    )
                    return

                function_outputs = payload.get("input", [])
                if function_outputs:
                    server.function_outputs.append(json.loads(function_outputs[0]["output"])["value"])

                send_json(
                    self,
                    200,
                    {
                        "id": "resp-proxy-2",
                        "object": "response",
                        "model": payload.get("model", "gpt-5"),
                        "output_text": "Read complete.",
                        "output": [
                            {
                                "type": "message",
                                "role": "assistant",
                                "content": [
                                    {
                                        "type": "output_text",
                                        "text": "Read complete.",
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
