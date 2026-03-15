from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional

from .client import AgentGuardClient
from .errors import AgentGuardHttpError
from .types import GuardedResult
from .wrappers import (
    DEFAULT_WAIT_FOR_APPROVAL_MS,
    guarded_exec_command,
    guarded_fetch,
    guarded_read_file,
    guarded_write_file,
)

DEFAULT_RESPONSES_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-5"
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "name": "read_file",
        "description": "Read a UTF-8 text file from the local machine.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "encoding": {"type": "string"},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "write_file",
        "description": "Write UTF-8 text content to a local file.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "encoding": {"type": "string"},
            },
            "required": ["path", "content"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "fetch",
        "description": "Make an HTTP request and return the response body as text.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "method": {"type": "string"},
                "data": {"type": "string"},
            },
            "required": ["url"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": "exec_command",
        "description": "Run a shell command and return stdout and stderr.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
            },
            "required": ["command"],
            "additionalProperties": False,
        },
    },
]


@dataclass(slots=True)
class ResponseFunctionCall:
    call_id: str
    name: str
    arguments: dict[str, Any]


def run_agent(
    task: str,
    *,
    model: str = DEFAULT_MODEL,
    responses_base_url: Optional[str] = None,
    daemon_base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    agent_name: str = "agentguard-python-responses-agent",
    max_turns: int = 8,
    approval_wait_ms: int = DEFAULT_WAIT_FOR_APPROVAL_MS,
) -> str:
    client = AgentGuardClient(base_url=daemon_base_url, agent=agent_name)
    response_id: Optional[str] = None
    pending_input: Any = task

    for _ in range(max_turns):
        response = create_response(
            base_url=responses_base_url
            or os.environ.get("OPENAI_BASE_URL")
            or DEFAULT_RESPONSES_BASE_URL,
            model=model,
            input_value=pending_input,
            previous_response_id=response_id,
            agent_name=agent_name,
            api_key=api_key or os.environ.get("OPENAI_API_KEY"),
            tools=TOOL_DEFINITIONS,
        )
        response_id = response["id"]

        function_calls = extract_function_calls(response)
        if not function_calls:
            return extract_final_output(response)

        pending_input = [
            {
                "type": "function_call_output",
                "call_id": tool_call.call_id,
                "output": json.dumps(
                    execute_tool_call(
                        client,
                        tool_call,
                        approval_wait_ms=approval_wait_ms,
                    )
                ),
            }
            for tool_call in function_calls
        ]

    raise RuntimeError(f"responses agent did not finish after {max_turns} turns")


def create_response(
    *,
    base_url: str,
    model: str,
    input_value: Any,
    previous_response_id: Optional[str],
    agent_name: str,
    api_key: Optional[str],
    tools: list[dict[str, Any]],
    timeout: float = 30.0,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "input": input_value,
        "tools": tools,
    }
    if previous_response_id is not None:
        body["previous_response_id"] = previous_response_id

    headers = {
        "content-type": "application/json",
        "x-agentguard-agent-name": agent_name,
    }
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    request = urllib.request.Request(
        responses_endpoint(base_url),
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers=headers,
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body_text = error.read().decode("utf-8")
        raise build_upstream_http_error(error.code, body_text) from error


def responses_endpoint(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/responses"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/responses"
    return f"{normalized}/v1/responses"


def build_upstream_http_error(status_code: int, body_text: str) -> Exception:
    try:
        details = json.loads(body_text)
    except json.JSONDecodeError:
        return RuntimeError(f"responses request failed with {status_code}: {body_text}")

    error = details.get("error") if isinstance(details, dict) else None
    message = error.get("message") if isinstance(error, dict) else None
    if isinstance(message, str):
        return AgentGuardHttpError(message=message, status=status_code, details=details)

    return RuntimeError(f"responses request failed with {status_code}: {body_text}")


def extract_function_calls(response: dict[str, Any]) -> list[ResponseFunctionCall]:
    calls: list[ResponseFunctionCall] = []

    for item in response.get("output", []):
        if item.get("type") != "function_call":
            continue

        raw_arguments = item.get("arguments", "{}")
        if isinstance(raw_arguments, str):
            arguments = json.loads(raw_arguments or "{}")
        elif isinstance(raw_arguments, dict):
            arguments = raw_arguments
        else:
            raise ValueError(f"unsupported function call arguments payload: {raw_arguments!r}")

        calls.append(
            ResponseFunctionCall(
                call_id=item["call_id"],
                name=item["name"],
                arguments=arguments,
            )
        )

    return calls


def extract_final_output(response: dict[str, Any]) -> str:
    output_text = response.get("output_text")
    if isinstance(output_text, str) and output_text:
        return output_text

    chunks: list[str] = []
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"}:
                text = content.get("text")
                if isinstance(text, str):
                    chunks.append(text)

    if chunks:
        return "\n".join(chunks)

    raise ValueError("responses output did not include a final assistant message")


def execute_tool_call(
    client: AgentGuardClient,
    tool_call: ResponseFunctionCall,
    *,
    approval_wait_ms: int,
) -> dict[str, Any]:
    if tool_call.name == "read_file":
        result = guarded_read_file(
            client,
            tool_call.arguments["path"],
            encoding=tool_call.arguments.get("encoding", "utf-8"),
            wait_for_approval_ms=approval_wait_ms,
        )
        return format_tool_result(result)

    if tool_call.name == "write_file":
        result = guarded_write_file(
            client,
            tool_call.arguments["path"],
            tool_call.arguments["content"],
            encoding=tool_call.arguments.get("encoding", "utf-8"),
            wait_for_approval_ms=approval_wait_ms,
        )
        return format_tool_result(result)

    if tool_call.name == "fetch":
        data = tool_call.arguments.get("data")
        result = guarded_fetch(
            client,
            tool_call.arguments["url"],
            method=tool_call.arguments.get("method", "GET"),
            data=data.encode("utf-8") if isinstance(data, str) else data,
            wait_for_approval_ms=approval_wait_ms,
        )
        try:
            body = result.value.read().decode("utf-8")
        finally:
            result.value.close()
        return format_tool_result(result, body=body)

    if tool_call.name == "exec_command":
        result = guarded_exec_command(
            client,
            tool_call.arguments["command"],
            wait_for_approval_ms=approval_wait_ms,
        )
        return format_tool_result(
            result,
            returncode=result.value.returncode,
            stdout=result.value.stdout,
            stderr=result.value.stderr,
        )

    raise ValueError(f"unsupported tool: {tool_call.name}")


def format_tool_result(result: GuardedResult[Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "audit": {
            "action": result.audit_record.decision.action,
            "risk": result.audit_record.decision.risk,
            "reason": result.audit_record.decision.reason,
            "operation": result.audit_record.event.operation,
            "target": result.audit_record.event.target.to_dict(),
        }
    }
    if result.value is not None and not extra:
        payload["value"] = normalize_value(result.value)
    payload.update(extra)
    return payload


def normalize_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a minimal OpenAI Responses API tool runner through AgentGuard.",
    )
    parser.add_argument("task", help="The user task the agent should solve.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--responses-base-url", default=None)
    parser.add_argument("--daemon-base-url", default=None)
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--agent-name", default="agentguard-python-responses-agent")
    parser.add_argument("--max-turns", type=int, default=8)
    parser.add_argument("--wait-for-approval-ms", type=int, default=DEFAULT_WAIT_FOR_APPROVAL_MS)
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    print(
        run_agent(
            args.task,
            model=args.model,
            responses_base_url=args.responses_base_url,
            daemon_base_url=args.daemon_base_url,
            api_key=args.api_key,
            agent_name=args.agent_name,
            max_turns=args.max_turns,
            approval_wait_ms=args.wait_for_approval_ms,
        )
    )
    return 0


__all__ = [
    "DEFAULT_MODEL",
    "DEFAULT_RESPONSES_BASE_URL",
    "ResponseFunctionCall",
    "TOOL_DEFINITIONS",
    "create_response",
    "execute_tool_call",
    "extract_final_output",
    "extract_function_calls",
    "main",
    "build_upstream_http_error",
    "responses_endpoint",
    "run_agent",
]
